import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { attachSupervisedChildShutdown, ownedShutdownExitCode } from '../src/cli-child-shutdown.js';
import { SD_SUPERVISED_ENV } from '../src/cli-restart-state.js';

for (const [signal, expected] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
] as const) {
  test(`supervised print joins provider cancellation and cleanup before returning ${expected}`, {
    timeout: 15_000,
  }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'sd-print-shutdown-'));
    const server = createServer((request) => request.resume());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const config = await writeConfig(root, address.port);
    const requested = once(server, 'request', { signal: AbortSignal.timeout(10_000) });
    const child = spawn(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx'),
        fileURLToPath(new URL('../src/cli.ts', import.meta.url)),
        '--mode',
        'print',
        '--config',
        config,
        '--cwd',
        root,
        '--no-profile',
        '--no-session',
        '--no-background',
        'wait for cancellation',
      ],
      {
        env: { ...process.env, [SD_SUPERVISED_ENV]: '1', SD_SIGNAL_TEST_KEY: 'fixture-only' },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-8192);
    });
    const exited = once(child, 'close');
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    });
    await Promise.race([
      requested,
      exited.then(() => {
        throw new Error(`Child exited before provider request: ${stderr}`);
      }),
    ]);
    child.kill(signal);
    const [code, exitSignal] = await exited;
    assert.equal(exitSignal, null, stderr);
    assert.equal(code, expected, stderr);
    assert.equal(await readFile(join(root, 'disposed.txt'), 'utf8'), 'disposed');
  });
}

test('owned shutdown classification does not hide unrelated cleanup failures', () => {
  const source = new EventEmitter();
  const shutdown = attachSupervisedChildShutdown(source);
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  assert.equal(ownedShutdownExitCode(abort, shutdown), undefined);
  source.emit('SIGINT');
  assert.equal(ownedShutdownExitCode(shutdown.signal.reason, shutdown), 130);
  assert.equal(ownedShutdownExitCode(abort, shutdown), 130);
  assert.equal(ownedShutdownExitCode(new Error('Agent run aborted'), shutdown), 130);
  assert.equal(
    ownedShutdownExitCode(new AggregateError([abort], 'cleanup failed'), shutdown),
    undefined,
  );
  assert.equal(ownedShutdownExitCode(new Error('provider failed'), shutdown), undefined);
  shutdown.dispose();
});

async function writeConfig(root: string, port: number): Promise<string> {
  const extension = join(root, 'extensions', 'shutdown');
  await mkdir(extension, { recursive: true });
  await writeFile(
    join(extension, 'snapdragon.extension.yaml'),
    'id: local/shutdown\nname: Shutdown\nmain: index.mjs\n',
  );
  await writeFile(
    join(extension, 'index.mjs'),
    [
      "import { writeFile } from 'node:fs/promises';",
      'export function activate(context) { context.registerDisposable(async () => {',
      'await new Promise(resolve => setTimeout(resolve, 25));',
      `await writeFile(${JSON.stringify(join(root, 'disposed.txt'))}, 'disposed');`,
      '}); }',
    ].join('\n'),
  );
  const path = join(root, 'sd.yaml');
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      default_provider: 'local',
      providers: {
        local: {
          kind: 'openai-compatible',
          model: 'fixture',
          api_key_env: 'SD_SIGNAL_TEST_KEY',
          base_url: `http://127.0.0.1:${port}/v1`,
        },
      },
      sessions: {
        root: join(root, 'sessions'),
        index: { path: join(root, 'sessions', 'index.sqlite') },
      },
      memory: { root: join(root, 'memory') },
      skills: { builtins: false, root: join(root, 'skills') },
      extensions: { builtins: false, roots: [join(root, 'extensions')] },
    }),
  );
  return path;
}
