import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';

export async function createTuiFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sd-tui-reliability-'));
  // Set HOME before importing sd's default paths; never touch the operator's home.
  process.env.HOME = root;
  const { createSdRuntime, stopSdRuntime } = await import('../../packages/sd/dist/runtime.js');
  const { SdUiController } = await import('../../packages/sd/dist/tui/ui.js');
  const { SdTuiApp } = await import('../../packages/sd/dist/tui/index.js');
  const { SdMouseInputAdapter } = await import('../../packages/sd/dist/tui/mouse-input-adapter.js');
  const { resumeRuntimeSession } = await import(
    '../../packages/sd/dist/runtime-session-transitions.js'
  );
  const { rebuildSdRuntime } = await import('../../packages/sd/dist/runtime-transitions.js');
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { mockProvider } = await import('@snapdragon-ai/host');
  await mkdir(join(root, 'workspace'));
  const configPath = join(root, 'config.yaml');
  await writeFile(
    configPath,
    JSON.stringify({
      version: 1,
      default_provider: 'mock',
      providers: { mock: { kind: 'mock', model: 'mock' } },
      skills: { builtins: false, root: join(root, 'skills') },
      extensions: { builtins: false, roots: [], hot_reload: false },
      webtools: { enabled: false },
      memory: { enabled: false, auto: { enabled: false }, context: { enabled: false } },
      sessions: {
        root: join(root, 'sessions'),
        title: { enabled: false },
        index: { enabled: false },
      },
      background: { mode: 'off' },
    }),
  );
  const runtime = await createSdRuntime(
    {
      cwd: join(root, 'workspace'),
      configPath,
      noProfile: true,
      profileRoot: join(root, 'profiles'),
      noBackground: true,
    },
    {},
  );
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => input;
  const output = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  output.isTTY = true;
  output.columns = 120;
  output.rows = 36;
  const mouse = new SdMouseInputAdapter({ input, output });
  let controller;
  let instance;
  const mount = () => {
    controller = new SdUiController(runtime);
    instance = render(createElement(SdTuiApp, { runtime, controller, mouseInput: mouse }), {
      stdin: mouse,
      stdout: output,
      stderr: output,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 1000,
    });
  };
  mount();
  await new Promise((resolve) => setImmediate(resolve));
  await instance.waitUntilRenderFlush();
  let exit = instance.waitUntilExit();
  instance.unmount();
  await exit;
  // cli-cursor installs process-global exit restoration once. Compare ownership
  // after that warm mount, not against a process that has never loaded a TUI.
  const initialSigintListeners = process.listenerCount('SIGINT');
  const initialProcessListeners = Object.fromEntries(
    process.eventNames().map((name) => [String(name), process.listenerCount(name)]),
  );
  mount();
  return {
    runtime,
    input,
    output,
    initialSigintListeners,
    initialProcessListeners,
    get controller() {
      return controller;
    },
    async flush() {
      await new Promise((resolve) => setImmediate(resolve));
      await instance.waitUntilRenderFlush();
    },
    async reload(resume) {
      exit = instance.waitUntilExit();
      instance.unmount();
      await exit;
      if (resume) await resumeRuntimeSession(runtime, runtime.session.sessionId);
      else await rebuildSdRuntime(runtime);
      mount();
      controller.bindRuntimeAgent();
      const mock = mockProvider({ chunkSize: 16 });
      mock.enqueueResponse({
        content: 'Reading fixture configuration.',
        tool_calls: [
          {
            id: `fixture-read-${Date.now()}`,
            name: 'read_file',
            args_json: JSON.stringify({ path: configPath }),
          },
        ],
      });
      mock.enqueue('Fixture configuration read successfully.');
      runtime.agent.setProvider(mock.handler);
      await runtime.agent.prompt('Read the local test configuration.');
    },
    async dispose() {
      exit = instance.waitUntilExit();
      instance.unmount();
      await exit;
      controller.dispose();
      mouse.dispose();
      await stopSdRuntime(runtime);
      input.destroy();
      output.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function streamFrame(fixture, frame) {
  const runId = `reliability-${Math.floor(frame / 20)}`;
  const offset = frame % 20;
  const emit = (event) => fixture.controller.acceptAgentEvent(event);
  if (offset === 0) emit({ type: 'run_start', runId });
  const delta = `Frame ${frame}: **streaming** text with \`code\` and changing content. ${'sample '.repeat(12)}\n`;
  emit({ type: 'provider_event', event: { kind: 'text', run_id: runId, provider: 'mock', delta } });
  // A non-buffered event flushes provider deltas into the real renderer every frame.
  const call = {
    id: `${runId}-${offset}`,
    name: 'fixture_tool',
    args_json: JSON.stringify({ frame }),
  };
  emit({ type: 'tool_start', call });
  emit({
    type: 'tool_end',
    call,
    content: `tool result ${frame}\n${'bounded output\n'.repeat(12)}`,
    isError: false,
  });
  if (offset === 19) {
    const message = { role: 'assistant', content: `Completed synthetic run ${runId}.` };
    fixture.runtime.session.appendMessage(message);
    emit({ type: 'message', message });
    emit({ type: 'run_end', runId, response: { content: message.content } });
  }
  if (frame % 25 === 0) {
    fixture.input.write('\x1b[<');
    fixture.input.write(`${frame % 50 === 0 ? 64 : 65};10;10M`);
  }
  if (frame % 100 === 0) {
    fixture.output.columns = 80 + (frame % 3) * 40;
    fixture.output.rows = 24 + (frame % 4) * 8;
    fixture.output.emit('resize');
  }
}
