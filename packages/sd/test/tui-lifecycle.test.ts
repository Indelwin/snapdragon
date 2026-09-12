import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createSdRuntime, stopSdRuntime } from '../src/runtime.js';
import { runTui } from '../src/tui/index.js';

class TerminalInput extends PassThrough {
  isTTY = true;
  raw = false;
  setRawMode(enabled: boolean) {
    this.raw = enabled;
    return this;
  }
}

class TerminalOutput extends Writable {
  isTTY = true;
  columns = 100;
  rows = 24;
  mouseEnabled = false;
  throwOnClear = false;
  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const text = chunk.toString();
    if (this.throwOnClear && text.includes('\x1b[2J')) throw new Error('clear failed');
    if (text.includes('\x1b[?1000h')) this.mouseEnabled = true;
    if (text.includes('\x1b[?1000l')) this.mouseEnabled = false;
    done();
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sd-tui-lifecycle-'));
  const configPath = join(root, 'config.yaml');
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      default_provider: 'mock',
      providers: { mock: { kind: 'mock', model: 'mock' } },
      sessions: { enabled: false, index: { enabled: false }, title: { enabled: false } },
      memory: { enabled: false, root: join(root, 'memory'), auto: { enabled: false } },
      skills: { root: join(root, 'skills'), builtins: false },
      extensions: { roots: [], builtins: false },
      todo: { enabled: false, file: join(root, 'todo.json') },
      webtools: { enabled: false },
      gateway: { root: join(root, 'gateway') },
      background: { mode: 'off', daemon: { root: join(root, 'gateway') } },
    }),
  );
  const runtime = await createSdRuntime(
    {
      cwd: root,
      configPath,
      noProfile: true,
      profileRoot: join(root, 'profiles'),
      noSession: true,
      noBackground: true,
    },
    {},
  );
  const input = new TerminalInput();
  const output = new TerminalOutput();
  return {
    runtime,
    input,
    output,
    async dispose() {
      await stopSdRuntime(runtime);
      input.destroy();
      output.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const action of ['quit', 'input-error', 'output-error'] as const) {
  test(`runTui awaits owned cleanup after ${action}`, async () => {
    const f = await fixture();
    const beforeExit = process.listenerCount('beforeExit');
    const running = runTui(f.runtime, {
      io: { input: f.input, output: f.output, error: f.output },
    });
    const settled = action === 'quit' ? running : assert.rejects(running, /fixture error/);
    try {
      const deadline = Date.now() + 3000;
      while (!f.output.mouseEnabled && Date.now() < deadline) await delay(5);
      assert(f.output.mouseEnabled, 'TUI did not enable injected mouse input');
      if (action === 'quit') f.input.write('\x03');
      else
        (action === 'input-error' ? f.input : f.output).emit('error', new Error('fixture error'));
      await settled;
      assert.equal(f.input.raw, false);
      assert.equal(f.output.mouseEnabled, false);
      assert.equal(f.input.listenerCount('data'), 0);
      assert.equal(f.input.listenerCount('error'), 0);
      assert.equal(f.output.listenerCount('resize'), 0);
      assert.equal(f.runtime.agent.listeners.size, 0);
      assert.equal(process.listenerCount('beforeExit'), beforeExit);
    } finally {
      await f.dispose();
    }
  });
}

test('clear-screen failure cannot leave an input adapter attached', async () => {
  const f = await fixture();
  f.output.throwOnClear = true;
  try {
    await assert.rejects(
      runTui(f.runtime, { io: { input: f.input, output: f.output, error: f.output } }),
      /clear failed/,
    );
    assert.equal(f.input.listenerCount('data'), 0);
    assert.equal(f.runtime.agent.listeners.size, 0);
  } finally {
    await f.dispose();
  }
});
