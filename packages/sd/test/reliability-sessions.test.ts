import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/args.ts';
import { loadSdConfig } from '../src/config.ts';
import { createSdRuntime, disposeRuntimeResources, stopSdRuntime } from '../src/runtime.ts';
import { observeSdRuntimeAgent } from '../src/runtime-agent-events.ts';
import { runtimeSessionStore } from '../src/runtime-session.ts';
import { rebuildSdRuntime } from '../src/runtime-transitions.ts';

test('successful runtime rebuild disposes the replaced ownership tree', async () => {
  const fixture = await runtimeFixture('successful-rebuild');
  const runtime = await createSdRuntime(fixture.args);
  const observedAgents = [];
  const stopObserving = observeSdRuntimeAgent(runtime, (agent) => observedAgents.push(agent));
  try {
    const oldAgent = runtime.agent;
    const oldSessionIndex = runtime.sessionIndex;
    const oldSearchIndex = runtime.searchIndex;
    assert.ok(oldSessionIndex);
    assert.ok(oldSearchIndex);

    await rebuildSdRuntime(runtime);

    assert.notStrictEqual(runtime.agent, oldAgent);
    assert.deepEqual(observedAgents, [runtime.agent]);
    await assert.rejects(oldAgent.prompt('after replacement'), /Agent is disposed/);
    assert.throws(() => oldSessionIndex.countSessions(), /closed|not open/i);
    assert.throws(() => oldSearchIndex.count('memory'), /closed|not open/i);
  } finally {
    stopObserving();
    await stopSdRuntime(runtime);
    await fixture.cleanup();
  }
});

test('successful rebuild keeps the candidate active when old cleanup throws', async () => {
  const fixture = await runtimeFixture('throwing-old-cleanup');
  const runtime = await createSdRuntime(fixture.args);
  try {
    const oldAgent = runtime.agent;
    const originalStop = runtime.background.stop.bind(runtime.background);
    runtime.background.stop = () => {
      originalStop();
      throw new Error('old stop failed');
    };

    await rebuildSdRuntime(runtime);

    assert.notStrictEqual(runtime.agent, oldAgent);
    assert.equal((await runtime.agent.prompt('candidate remains active')).content, 'mock response');
  } finally {
    await stopSdRuntime(runtime);
    await fixture.cleanup();
  }
});

test('failed runtime rebuild leaves the old runtime active and disposes the candidate', async () => {
  const fixture = await runtimeFixture('failed-rebuild', true);
  const runtime = await createSdRuntime(fixture.args);
  let observedChanges = 0;
  const stopObserving = observeSdRuntimeAgent(runtime, () => {
    observedChanges += 1;
  });
  try {
    const oldAgent = runtime.agent;
    const badConfig = await loadSdConfig(fixture.configPath);

    await assert.rejects(
      rebuildSdRuntime(runtime, {
        baseConfig: badConfig,
        provider: 'bad',
        model: 'bad-model',
      }),
      /candidate provider failed/,
    );

    assert.strictEqual(runtime.agent, oldAgent);
    assert.equal(observedChanges, 0);
    assert.equal((await oldAgent.prompt('still active')).content, 'mock response');
    assert.deepEqual(await markerLines(fixture.markerPath), ['candidate disposed']);
  } finally {
    stopObserving();
    await stopSdRuntime(runtime);
    assert.deepEqual(await markerLines(fixture.markerPath), [
      'candidate disposed',
      'candidate disposed',
    ]);
    await fixture.cleanup();
  }
});

test('failed candidate preparation rolls back only newly owned empty sessions', async () => {
  const fixture = await runtimeFixture('candidate-session-rollback');
  const runtime = await createSdRuntime(fixture.args);
  try {
    const store = runtimeSessionStore(await loadSdConfig(fixture.configPath));
    const existing = store.create('existing-empty');
    await writeFailingToolsetExtension(fixture.extensionRoot, fixture.markerPath);
    const badConfig = await loadSdConfig(fixture.configPath);

    await assert.rejects(
      rebuildSdRuntime(runtime, { baseConfig: badConfig, session: existing }),
      /candidate toolset failed/,
    );
    assert.equal(
      store.exists(existing.sessionId),
      true,
      'existing session must remain owned by user',
    );

    const before = store.list().map((entry) => entry.session_id);
    await assert.rejects(
      rebuildSdRuntime(runtime, { baseConfig: badConfig, session: null, createSession: true }),
      /candidate toolset failed/,
    );

    assert.deepEqual(
      store.list().map((entry) => entry.session_id),
      before,
      'new empty candidate session must be removed',
    );
    assert.deepEqual(await markerLines(fixture.markerPath), [
      'toolset disposed',
      'toolset disposed',
    ]);
  } finally {
    await stopSdRuntime(runtime);
    await fixture.cleanup();
  }
});

test('repeated runtime create, rebuild, and idempotent stop restore process listeners', async () => {
  const fixture = await runtimeFixture('repeat-dispose');
  const baseline = processListenerCounts();
  try {
    for (let index = 0; index < 10; index += 1) {
      const runtime = await createSdRuntime(fixture.args);
      await rebuildSdRuntime(runtime);
      await Promise.all([stopSdRuntime(runtime), stopSdRuntime(runtime)]);
      assert.deepEqual(
        processListenerCounts(),
        baseline,
        `listener drift after cycle ${index + 1}`,
      );
    }
  } finally {
    await fixture.cleanup();
  }
});

test('runtime shutdown awaits extension disposables and deactivation once in reverse order', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-extension-dispose-'));
  const markerPath = join(workspace, 'extension-disposal.log');
  const extensionRoot = join(workspace, 'extensions');
  try {
    await writeLifecycleExtension(extensionRoot, markerPath);
    const configPath = join(workspace, 'sd.yaml');
    await writeFile(configPath, runtimeConfig(workspace, extensionRoot, false), 'utf8');
    const runtime = await createSdRuntime(
      parseArgs(['--config', configPath, '--cwd', workspace, '--no-session', '--no-background']),
    );

    await Promise.all([stopSdRuntime(runtime), stopSdRuntime(runtime)]);

    assert.deepEqual(await markerLines(markerPath), [
      'activation return',
      'registered disposable',
      'deactivate',
    ]);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('runtime disposal attempts every owner after throwing cleanup', async () => {
  const calls: string[] = [];
  const throwing = (name: string) => {
    calls.push(name);
    throw new Error(`${name} failed`);
  };
  await disposeRuntimeResources({
    agent: { dispose: async () => throwing('agent') },
    background: {
      stop: () => throwing('background stop'),
      flush: async () => throwing('background flush'),
    },
    sessionIndex: { close: () => throwing('session index') },
    searchIndex: { close: () => throwing('search index') },
    extensionRuntime: { dispose: async () => throwing('extensions') },
  } as never);

  assert.equal(calls[0], 'background stop');
  assert.deepEqual(
    new Set(calls),
    new Set([
      'background stop',
      'agent',
      'background flush',
      'session index',
      'search index',
      'extensions',
    ]),
  );
});

interface RuntimeFixture {
  args: ReturnType<typeof parseArgs>;
  configPath: string;
  extensionRoot: string;
  markerPath: string;
  cleanup(): Promise<void>;
}

async function runtimeFixture(name: string, badProvider = false): Promise<RuntimeFixture> {
  const workspace = await mkdtemp(join(tmpdir(), `snapdragon-${name}-`));
  const markerPath = join(workspace, 'extension-disposal.log');
  const extensionRoot = join(workspace, 'extensions');
  if (badProvider) await writeBadProviderExtension(extensionRoot, markerPath);
  const configPath = join(workspace, 'sd.yaml');
  await writeFile(configPath, runtimeConfig(workspace, extensionRoot, badProvider), 'utf8');
  return {
    args: parseArgs([
      '--config',
      configPath,
      '--cwd',
      workspace,
      '--no-session',
      '--no-background',
    ]),
    configPath,
    extensionRoot,
    markerPath,
    cleanup: () => rm(workspace, { force: true, recursive: true }),
  };
}

async function writeFailingToolsetExtension(root: string, markerPath: string): Promise<void> {
  const dir = join(root, 'failing-toolset');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'snapdragon.extension.yaml'),
    ['id: local/failing-toolset', 'name: Failing Toolset', 'main: index.mjs', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'index.mjs'),
    [
      "import { appendFile } from 'node:fs/promises';",
      'export function activate(context) {',
      '  context.registerToolset({',
      "    name: 'candidate-failure',",
      "    title: 'Candidate failure',",
      "    description: 'Fails candidate preparation',",
      '    tools: [],',
      "    check() { throw new Error('candidate toolset failed'); },",
      `    dispose() { return appendFile(${JSON.stringify(markerPath)}, 'toolset disposed\\n'); }`,
      '  });',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function writeBadProviderExtension(root: string, markerPath: string): Promise<void> {
  const dir = join(root, 'bad-provider');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'snapdragon.extension.yaml'),
    ['id: local/bad-provider', 'name: Bad Provider', 'main: index.mjs', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'index.mjs'),
    [
      "import { appendFile } from 'node:fs/promises';",
      'export function activate(context) {',
      `  context.registerDisposable(() => appendFile(${JSON.stringify(markerPath)}, 'candidate disposed\\n'));`,
      "  context.registerDisposable(() => { throw new Error('candidate cleanup failed'); });",
      "  context.registerProvider('provider/bad', {",
      "    create() { throw new Error('candidate provider failed'); }",
      '  });',
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function writeLifecycleExtension(root: string, markerPath: string): Promise<void> {
  const dir = join(root, 'lifecycle');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'snapdragon.extension.yaml'),
    ['id: local/lifecycle', 'name: Lifecycle', 'main: index.mjs', ''].join('\n'),
    'utf8',
  );
  await writeFile(
    join(dir, 'index.mjs'),
    [
      "import { appendFile } from 'node:fs/promises';",
      'export function activate(context) {',
      `  context.registerDisposable(() => appendFile(${JSON.stringify(markerPath)}, 'registered disposable\\n'));`,
      `  return () => appendFile(${JSON.stringify(markerPath)}, 'activation return\\n');`,
      '}',
      'export function deactivate() {',
      `  return appendFile(${JSON.stringify(markerPath)}, 'deactivate\\n');`,
      '}',
      '',
    ].join('\n'),
    'utf8',
  );
}

function runtimeConfig(workspace: string, extensionRoot: string, badProvider: boolean): string {
  const lines = [
    'version: 1',
    'default_provider: mock',
    'providers:',
    '  mock:',
    '    kind: mock',
    '    model: mock',
  ];
  if (badProvider) {
    lines.push(
      '  bad:',
      '    kind: extension',
      '    extension: provider/bad',
      '    model: bad-model',
    );
  }
  lines.push(
    'sessions:',
    `  root: "${yamlPath(join(workspace, 'sessions'))}"`,
    '  index:',
    `    path: "${yamlPath(join(workspace, 'sessions', 'index.sqlite'))}"`,
    'memory:',
    `  root: "${yamlPath(join(workspace, 'memory'))}"`,
    'skills:',
    '  builtins: false',
    `  root: "${yamlPath(join(workspace, 'skills'))}"`,
    'extensions:',
    '  builtins: false',
    '  roots:',
    `    - "${yamlPath(extensionRoot)}"`,
    '',
  );
  return lines.join('\n');
}

function processListenerCounts(): Record<string, number> {
  return Object.fromEntries(
    process
      .eventNames()
      .map((name) => [String(name), process.listenerCount(name)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

async function markerLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, 'utf8')).trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function yamlPath(path: string): string {
  return path.replace(/"/g, '\\"');
}
