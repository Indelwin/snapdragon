import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { AgentEvent, SnapdragonAgent } from '@snapdragon-ai/agent';
import {
  registerSdWasmPageGetter,
  startSdDiagnostics,
  startSdRuntimeDiagnostics,
} from '../src/diagnostics.ts';
import { bindSdDiagnosticsAgentPhases } from '../src/diagnostics-agent-phase.ts';
import type { SdDiagnosticsOptions, SdDiagnosticsSample } from '../src/diagnostics-types.ts';
import { diagnosticsWasmPages } from '../src/diagnostics-wasm.ts';
import { registerSdWebtoolsWasmPages } from '../src/diagnostics-webtools.ts';
import type { SdDiagnosticsWriterDependencies } from '../src/diagnostics-writer.ts';
import { runSelectedMode } from '../src/run-mode.ts';
import { createSdRuntime, type SdRuntime, stopSdRuntime } from '../src/runtime.ts';
import { notifySdRuntimeAgentChanged, observeSdRuntimeAgent } from '../src/runtime-agent-events.ts';
import { rebuildSdRuntime } from '../src/runtime-transitions.ts';

test('diagnostics stays off unless explicitly enabled', async () => {
  const directory = join(tmpdir(), `snapdragon-diagnostics-disabled-${process.pid}-${Date.now()}`);
  const handle = startSdRuntimeDiagnostics({ diagnostics: false }, { directory });
  assert.equal(handle.enabled, false);
  assert.equal(handle.path, null);
  await handle.sample();
  await handle.stop();
  await assert.rejects(stat(directory), { code: 'ENOENT' });
});

test('diagnostics writes fixed privacy-safe metrics and optional WASM pages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-private-'));
  const secret = 'DO_NOT_REPORT_API_KEY';
  process.env.SD_DIAGNOSTICS_TEST_SECRET = secret;
  let beforeSamples = 0;
  const unregisterCore = registerSdWasmPageGetter('core', () => 12);
  const unregisterWebtools = registerSdWasmPageGetter('webtools', () => {
    throw new Error(secret);
  });
  try {
    const handle = startSdDiagnostics({
      ...testOptions(directory),
      enabled: true,
      initialPhase: secret as 'unknown',
      activeResources: () => ['FSReqPromise', 'Timeout', secret],
      beforeSample: () => {
        beforeSamples += 1;
        throw new Error(secret);
      },
    });
    await handle.flush();
    const raw = await readFile(handle.path ?? '', 'utf8');
    const sample = JSON.parse(raw.trim()) as SdDiagnosticsSample;
    assert.equal(sample.schemaVersion, 1);
    assert.equal(beforeSamples, 1);
    assert.equal(sample.phase, 'unknown');
    assert.deepEqual(sample.process.memoryBytes, {
      rss: 101,
      heapTotal: 102,
      heapUsed: 103,
      external: 104,
      arrayBuffers: 105,
    });
    assert.deepEqual(sample.resources, {
      total: 3,
      fileSystem: 1,
      network: 0,
      timers: 1,
      processes: 0,
      signals: 0,
      terminal: 0,
      other: 1,
    });
    assert.deepEqual(sample.wasmPages, { core: 12, webtools: null });
    assert.doesNotMatch(raw, new RegExp(secret));
    assert.doesNotMatch(raw, /argv|cwd|environment|payload|heapdump|key/i);
    await handle.stop();
  } finally {
    delete process.env.SD_DIAGNOSTICS_TEST_SECRET;
    unregisterCore();
    unregisterWebtools();
    await rm(directory, { force: true, recursive: true });
  }
});

test('diagnostics tracks agent phases and rebinds immediately after agent replacement', () => {
  const first = new TestAgent();
  const second = new TestAgent();
  const runtime = { agent: first as SnapdragonAgent };
  const phases: string[] = [];
  const binding = bindSdDiagnosticsAgentPhases(runtime, {
    setPhase: (phase) => phases.push(phase),
  });

  first.emit({ type: 'run_start', runId: 'run-1' });
  first.emit({
    type: 'provider_event',
    event: { kind: 'text', run_id: 'run-1', provider: 'mock', delta: 'not retained' },
  });
  first.emit({ type: 'tool_start', call: { id: 'call-1', name: 'test', args_json: '{}' } });
  first.emit({ type: 'run_end', runId: 'run-1', response: response() });

  runtime.agent = second as SnapdragonAgent;
  notifySdRuntimeAgentChanged(runtime);
  first.emit({ type: 'run_start', runId: 'stale' });
  second.emit({ type: 'run_start', runId: 'run-2' });
  binding.dispose();
  second.emit({ type: 'tool_start', call: { id: 'stale', name: 'test', args_json: '{}' } });

  assert.deepEqual(phases, ['idle', 'running', 'provider', 'tool', 'idle', 'idle', 'running']);
});

test('diagnostics follows the new agent across a real runtime rebuild', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-rebuild-'));
  const configPath = await writeMockConfig(workspace);
  const runtime = await createSdRuntime({ cwd: workspace, configPath, noSession: true });
  const initialAgent = runtime.agent;
  const phases: string[] = [];
  const binding = bindSdDiagnosticsAgentPhases(runtime, {
    setPhase: (phase) => phases.push(phase),
  });
  try {
    assert.equal(initialAgent.listeners.size, 1);
    await rebuildSdRuntime(runtime);
    assert.notStrictEqual(runtime.agent, initialAgent);
    assert.equal(initialAgent.listeners.size, 0);
    assert.equal(runtime.agent.listeners.size, 1);

    const promptStart = phases.length;
    await runtime.agent.prompt('after rebuild');
    const promptPhases = phases.slice(promptStart);
    assert.equal(promptPhases[0], 'running');
    assert.ok(promptPhases.includes('provider'));
    assert.equal(promptPhases.at(-1), 'idle');
  } finally {
    binding.dispose();
    assert.equal(runtime.agent.listeners.size, 0);
    stopSdRuntime(runtime);
    await rm(workspace, { force: true, recursive: true });
  }
});

test('webtools WASM diagnostics load only when enabled and dispose their numeric getter', async () => {
  let loads = 0;
  const disabledDispose = await registerSdWebtoolsWasmPages(false, async () => {
    loads += 1;
    return {};
  });
  assert.equal(loads, 0);
  assert.equal(diagnosticsWasmPages().webtools, null);
  disabledDispose();

  let statsReads = 0;
  const dispose = await registerSdWebtoolsWasmPages(true, async () => {
    loads += 1;
    return {
      getWebtoolsWasmMemoryStats: () => {
        statsReads += 1;
        return {
          memoryPages: 23.9,
          maxCoreMemoryPages: 40,
          activeCores: 1,
          registryEntries: 1,
          droppedRegistrations: 0,
        };
      },
    };
  });
  assert.equal(loads, 1);
  assert.equal(statsReads, 0);
  assert.equal(diagnosticsWasmPages().webtools, 23);
  assert.equal(statsReads, 1);
  dispose();
  assert.equal(diagnosticsWasmPages().webtools, null);
});

test('webtools WASM diagnostics tolerate the pre-capability module shape', async () => {
  const dispose = await registerSdWebtoolsWasmPages(true, async () => ({ webtoolsToolset: {} }));
  assert.equal(diagnosticsWasmPages().webtools, null);
  dispose();
});

test('diagnostics agent observers preserve runtime properties and dispose independently', () => {
  const agent = new TestAgent();
  const runtime = { agent: agent as SnapdragonAgent };
  const original = Object.getOwnPropertyDescriptor(runtime, 'agent');
  const first = bindSdDiagnosticsAgentPhases(runtime, { setPhase: () => {} });
  const second = bindSdDiagnosticsAgentPhases(runtime, { setPhase: () => {} });

  assert.equal(agent.subscriberCount, 2);
  first.dispose();
  assert.equal(agent.subscriberCount, 1);
  assert.deepEqual(Object.getOwnPropertyDescriptor(runtime, 'agent'), original);
  second.dispose();

  assert.equal(agent.subscriberCount, 0);
  assert.deepEqual(Object.getOwnPropertyDescriptor(runtime, 'agent'), original);
});

test('runtime transition observers isolate failures and stale disposal', () => {
  const runtime = { agent: new TestAgent() as SnapdragonAgent };
  const old = observeSdRuntimeAgent(runtime, () => {});
  old();
  let calls = 0;
  const stop = observeSdRuntimeAgent(runtime, () => {
    calls += 1;
  });
  const stopThrowing = observeSdRuntimeAgent(runtime, () => {
    throw new Error('observer');
  });
  old();
  assert.doesNotThrow(() => notifySdRuntimeAgentChanged(runtime));
  assert.equal(calls, 1);
  stop();
  stopThrowing();
  notifySdRuntimeAgentChanged(runtime);
  assert.equal(calls, 1);
});

test('diagnostics rotates within the configured file and byte bounds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-rotate-'));
  try {
    const handle = startSdDiagnostics({
      ...testOptions(directory),
      enabled: true,
      maxFileBytes: 4096,
      maxFiles: 3,
    });
    for (let index = 0; index < 40; index += 1) await handle.sample();
    await handle.stop();
    const files = (await readdir(directory)).sort();
    assert.deepEqual(files, ['metrics.1.jsonl', 'metrics.2.jsonl', 'metrics.jsonl']);
    for (const file of files) {
      assert.ok((await stat(join(directory, file))).size <= 4096);
      for (const line of (await readFile(join(directory, file), 'utf8')).trim().split('\n')) {
        assert.equal((JSON.parse(line) as SdDiagnosticsSample).schemaVersion, 1);
      }
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('aborting diagnostics cancels future interval samples', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-abort-'));
  const controller = new AbortController();
  try {
    const handle = startSdDiagnostics({
      ...testOptions(directory),
      enabled: true,
      intervalMs: 10,
      signal: controller.signal,
    });
    await handle.flush();
    await delay(35);
    controller.abort();
    await handle.stop();
    const countAfterAbort = await lineCount(handle.path ?? '');
    await delay(35);
    await handle.flush();
    assert.equal(await lineCount(handle.path ?? ''), countAfterAbort);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('diagnostics prunes old rotation policies without touching unrelated files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-prune-'));
  try {
    for (const name of ['metrics.jsonl', 'metrics.1.jsonl', 'metrics.8.jsonl']) {
      await writeFile(join(directory, name), 'x'.repeat(8192));
    }
    await writeFile(join(directory, 'unrelated.jsonl'), 'keep');
    const handle = startSdDiagnostics({
      ...testOptions(directory),
      enabled: true,
      maxFileBytes: 4096,
      maxFiles: 2,
    });
    await handle.stop();
    const files = (await readdir(directory)).sort();
    assert.deepEqual(files, ['metrics.jsonl', 'unrelated.jsonl']);
    assert((await stat(join(directory, 'metrics.jsonl'))).size <= 4096);
    assert.equal(await readFile(join(directory, 'unrelated.jsonl'), 'utf8'), 'keep');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('diagnostics coalesces a flooded slow writer to one pending sample', async () => {
  const writes: Array<() => void> = [];
  const dependencies: SdDiagnosticsWriterDependencies = {
    writeSample: async () => new Promise<void>((resolve) => writes.push(resolve)),
  };
  const handle = startSdDiagnostics({ ...testOptions(tmpdir()), enabled: true }, dependencies);
  assert.equal(writes.length, 1);

  const flooded = Array.from({ length: 100 }, () => handle.sample());
  assert.equal(writes.length, 1);
  writes.shift()?.();
  await waitFor(() => writes.length === 1);
  assert.equal(writes.length, 1);
  writes.shift()?.();
  await Promise.all(flooded);
  await handle.stop();
});

test('diagnostics contains writer failures even when onError throws', async () => {
  let errors = 0;
  const handle = startSdDiagnostics(
    {
      ...testOptions(tmpdir()),
      enabled: true,
      intervalMs: 10,
      onError: async () => {
        errors += 1;
        throw new Error('failing error observer');
      },
    },
    {
      writeSample: async () => {
        throw new Error('failing diagnostics writer');
      },
    },
  );
  await handle.flush();
  await delay(25);
  await handle.stop();
  assert.ok(errors >= 2);
});

test('run mode starts CLI diagnostics and stops them when execution fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'snapdragon-diagnostics-run-mode-'));
  const agent = new TestAgent();
  const runtime = {
    agent: agent as SnapdragonAgent,
    options: { diagnostics: true },
  } as SdRuntime;
  try {
    await assert.rejects(
      runSelectedMode('print', runtime, undefined, {
        diagnostics: { ...testOptions(directory), initialPhase: 'startup' },
      }),
      /Print mode requires a prompt/,
    );
    const lines = (await readFile(join(directory, 'metrics.jsonl'), 'utf8')).trim().split('\n');
    assert.deepEqual(
      lines.map((line) => (JSON.parse(line) as SdDiagnosticsSample).phase),
      ['startup', 'shutdown'],
    );
    assert.equal(agent.subscriberCount, 0);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('run mode does not subscribe to agent events when diagnostics is disabled', async () => {
  const agent = new TestAgent();
  const runtime = {
    agent: agent as SnapdragonAgent,
    options: { diagnostics: false },
  } as SdRuntime;
  await assert.rejects(runSelectedMode('print', runtime, undefined), /requires a prompt/);
  assert.equal(agent.subscriberCount, 0);
});

class TestAgent {
  readonly #listeners = new Set<(event: AgentEvent) => void>();

  get subscriberCount(): number {
    return this.#listeners.size;
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: AgentEvent): void {
    for (const listener of this.#listeners) listener(event);
  }
}

function response() {
  return { content: 'done', finish_reason: 'stop' as const };
}

function testOptions(directory: string): SdDiagnosticsOptions {
  return {
    directory,
    intervalMs: 0,
    now: () => Date.parse('2026-09-12T00:00:00.000Z'),
    uptime: () => 42.5,
    memoryUsage: () => ({
      rss: 101,
      heapTotal: 102,
      heapUsed: 103,
      external: 104,
      arrayBuffers: 105,
    }),
    activeResources: () => [],
  };
}

async function writeMockConfig(workspace: string): Promise<string> {
  const configPath = join(workspace, 'sd.yaml');
  await writeFile(
    configPath,
    [
      'version: 1',
      'default_provider: mock',
      'providers:',
      '  mock:',
      '    kind: mock',
      '    model: mock',
      'sessions:',
      '  enabled: false',
      'skills:',
      '  builtins: false',
      `  root: "${join(workspace, 'skills')}"`,
      'memory:',
      `  root: "${join(workspace, 'memory')}"`,
      'extensions:',
      '  builtins: false',
      '  roots:',
      `    - "${join(workspace, 'extensions')}"`,
      '',
    ].join('\n'),
    'utf8',
  );
  return configPath;
}

async function lineCount(path: string): Promise<number> {
  const text = await readFile(path, 'utf8');
  return text.trim() ? text.trim().split('\n').length : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await delay(1);
  }
  assert.fail('condition was not reached');
}
