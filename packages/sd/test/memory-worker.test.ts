import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SessionStore } from '@snapdragon-ai/session';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { SdMemoryStore } from '../src/memory.ts';
import { runSdMemoryWorkerOnce, startSdMemoryWorker } from '../src/memory-worker.ts';
import { readMemoryWorkerState, writeMemoryWorkerState } from '../src/memory-worker-state.ts';

interface Fixture {
  workspace: string;
  config: SdConfig;
  memory: SdMemoryStore;
  memoryPath: string;
  sessionsRoot: string;
  cleanup: () => Promise<void>;
}

async function makeFixture(): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), 'sd-memory-worker-'));
  const memoryRoot = join(workspace, 'memory');
  const sessionsRoot = join(workspace, 'sessions');
  await mkdir(memoryRoot, { recursive: true });
  await mkdir(sessionsRoot, { recursive: true });
  const memoryPath = join(memoryRoot, 'MEMORY.md');
  const config: SdConfig = {
    ...defaultSdConfig(),
    sessions: { enabled: true, root: sessionsRoot },
    memory: {
      enabled: true,
      authoring: true,
      root: memoryRoot,
      file: 'MEMORY.md',
      auto: { enabled: true, max_entry_chars: 1200 },
      worker: { enabled: false, lookback_sessions: 10 },
    },
  };
  const memory = new SdMemoryStore({ path: memoryPath });
  return {
    workspace,
    config,
    memory,
    memoryPath,
    sessionsRoot,
    cleanup: () => rm(workspace, { force: true, recursive: true }),
  };
}

async function writeJsonlSession(
  sessionsRoot: string,
  sessionId: string,
  messages: Array<{ role: 'user' | 'assistant'; text: string; created_at: number }>,
): Promise<void> {
  const path = join(sessionsRoot, `${sessionId}.jsonl`);
  const lines: string[] = [
    JSON.stringify({
      type: 'session_open',
      session_id: sessionId,
      created_at: messages[0]?.created_at ?? Date.now() / 1000,
      schema_version: 1,
    }),
  ];
  messages.forEach((message, index) => {
    lines.push(
      JSON.stringify({
        type: 'message',
        store_id: index + 1,
        role: message.role,
        content: message.text,
        created_at: message.created_at,
      }),
    );
  });
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
}

test('worker captures triggered user messages from recent sessions', async () => {
  const fx = await makeFixture();
  try {
    await writeJsonlSession(fx.sessionsRoot, 'sess-a', [
      { role: 'user', text: 'remember to run pack dry before release', created_at: 100 },
      { role: 'assistant', text: 'noted', created_at: 101 },
    ]);

    const result = await runSdMemoryWorkerOnce({ config: fx.config, memory: fx.memory });

    assert.equal(result.scanned_sessions, 1);
    assert.equal(result.captured, 1);
    assert.equal(result.skipped_duplicates, 0);
    assert.deepEqual(result.errors, []);
    const memoryRaw = await readFile(fx.memoryPath, 'utf8');
    assert.match(memoryRaw, /pack dry/);
    // New capture title format is `Auto: <extracted preview>` and entries
    // are tagged with both 'auto' and 'tentative'.
    assert.match(memoryRaw, /## .*Auto:/);
    assert.match(memoryRaw, /tags:[^\n]*tentative/);
    assert.match(memoryRaw, /run pack dry before release/);
  } finally {
    await fx.cleanup();
  }
});

test('worker is idempotent across runs via watermark and dedupe hashing', async () => {
  const fx = await makeFixture();
  try {
    await writeJsonlSession(fx.sessionsRoot, 'sess-b', [
      { role: 'user', text: 'remember to format with biome', created_at: 200 },
    ]);

    const first = await runSdMemoryWorkerOnce({ config: fx.config, memory: fx.memory });
    const second = await runSdMemoryWorkerOnce({ config: fx.config, memory: fx.memory });

    assert.equal(first.captured, 1);
    assert.equal(second.captured, 0);
    assert.equal(second.considered_messages, 0, 'watermark should skip already-seen messages');

    const memoryRaw = await readFile(fx.memoryPath, 'utf8');
    const matches = memoryRaw.match(/^## .*Auto:/gm) ?? [];
    assert.equal(matches.length, 1, 'should not duplicate the same capture across scans');
  } finally {
    await fx.cleanup();
  }
});

test('worker ignores assistant turns and untriggered user turns', async () => {
  const fx = await makeFixture();
  try {
    await writeJsonlSession(fx.sessionsRoot, 'sess-c', [
      { role: 'user', text: 'how do I run the tests', created_at: 300 },
      { role: 'assistant', text: 'remember to format', created_at: 301 },
    ]);

    const result = await runSdMemoryWorkerOnce({ config: fx.config, memory: fx.memory });

    assert.equal(result.captured, 0);
    const memoryRaw = await readFile(fx.memoryPath, 'utf8');
    assert.doesNotMatch(memoryRaw, /^## .*Auto:/m);
  } finally {
    await fx.cleanup();
  }
});

test('worker scans user turns without parsing large tool-result payloads', async () => {
  const fx = await makeFixture();
  try {
    const path = join(fx.sessionsRoot, 'sess-large-tool.jsonl');
    const records = [
      JSON.stringify({
        type: 'session_open',
        session_id: 'sess-large-tool',
        created_at: 600,
        schema_version: 1,
      }),
      JSON.stringify({
        type: 'message',
        store_id: 1,
        role: 'user',
        content: 'remember to avoid full JSON parsing in workers',
        created_at: 601,
      }),
      JSON.stringify({
        type: 'message',
        store_id: 2,
        role: 'tool',
        content: 'x'.repeat(900_000),
        tool_call_id: 'call_1',
        created_at: 602,
      }),
    ];
    await writeFile(path, `${records.join('\n')}\n`, 'utf8');

    const result = await runSdMemoryWorkerOnce({ config: fx.config, memory: fx.memory });

    assert.equal(result.captured, 1);
    assert.deepEqual(result.errors, []);
    const memoryRaw = await readFile(fx.memoryPath, 'utf8');
    assert.match(memoryRaw, /avoid full JSON parsing/);
  } finally {
    await fx.cleanup();
  }
});

test('worker state reader handles missing, malformed, and valid files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sd-memory-worker-state-'));
  try {
    const statePath = join(workspace, 'nested', 'worker-state.json');
    assert.deepEqual(readMemoryWorkerState(statePath), { version: 1, sessions: {} });

    await mkdir(join(workspace, 'nested'), { recursive: true });
    await writeFile(statePath, 'not json', 'utf8');
    assert.deepEqual(readMemoryWorkerState(statePath), { version: 1, sessions: {} });

    writeMemoryWorkerState(statePath, {
      version: 1,
      sessions: { sess: { last_processed_at: 123 } },
    });
    assert.deepEqual(readMemoryWorkerState(statePath), {
      version: 1,
      sessions: { sess: { last_processed_at: 123 } },
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('worker no-ops when memory is disabled', async () => {
  const fx = await makeFixture();
  try {
    await writeJsonlSession(fx.sessionsRoot, 'sess-d', [
      { role: 'user', text: 'remember to ship it', created_at: 400 },
    ]);
    const config: SdConfig = { ...fx.config, memory: { ...fx.config.memory, enabled: false } };

    const result = await runSdMemoryWorkerOnce({ config, memory: fx.memory });

    assert.equal(result.scanned_sessions, 0);
    assert.equal(result.captured, 0);
  } finally {
    await fx.cleanup();
  }
});

test('startSdMemoryWorker returns undefined when worker is disabled', async () => {
  const fx = await makeFixture();
  try {
    const handle = startSdMemoryWorker({ config: fx.config, memory: fx.memory });
    assert.equal(handle, undefined);
  } finally {
    await fx.cleanup();
  }
});

test('startSdMemoryWorker schedules scans and stops cleanly when enabled', async () => {
  const fx = await makeFixture();
  try {
    await writeJsonlSession(fx.sessionsRoot, 'sess-e', [
      { role: 'user', text: 'remember to bump the changeset', created_at: 500 },
    ]);
    const config: SdConfig = {
      ...fx.config,
      memory: {
        ...fx.config.memory,
        worker: { enabled: true, interval_ms: 10, lookback_sessions: 10 },
      },
    };
    const handle = startSdMemoryWorker({ config, memory: fx.memory });
    assert.ok(handle, 'expected worker handle when enabled');
    // wait for at least one tick
    await new Promise((resolve) => setTimeout(resolve, 50));
    await handle.flush();
    handle.stop();

    const memoryRaw = await readFile(fx.memoryPath, 'utf8');
    assert.match(memoryRaw, /bump the changeset/);
  } finally {
    await fx.cleanup();
  }
});

test('SessionStore generates valid session ids that the worker can consume', () => {
  // sanity check that our test fixture lines up with the real id format
  const id = SessionStore.generateId(new Date('2026-04-28T00:00:00Z'));
  assert.match(id, /^\d{8}_\d{6}_[0-9a-f]{6}$/);
});
