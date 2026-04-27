import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import test from 'node:test';
import { JsonlSession } from '@snapdragon-ai/session';
import { formatDuration, renderExitSummary, writeExitSummary } from '../src/exit-summary.ts';
import type { SdRuntime } from '../src/runtime.ts';
import { printSessionList } from '../src/session-list-output.ts';
import { summarizeSession } from '../src/session-summary.ts';

test('summarizeSession reads title, duration, messages, and tool call counts', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-summary-'));
  try {
    const path = join(workspace, 'alpha.jsonl');
    await writeSessionFile(path, [
      {
        type: 'session_open',
        session_id: 'alpha',
        created_at: 10,
        schema_version: 1,
        meta: { title: 'Initial title' },
      },
      { type: 'message', store_id: 1, role: 'system', content: 'setup', created_at: 12 },
      { type: 'message', store_id: 2, role: 'user', content: 'Run the check', created_at: 20 },
      {
        type: 'message',
        store_id: 3,
        role: 'assistant',
        content: 'I will inspect it.',
        created_at: 28,
        tool_calls: [{ id: 'tool_1', name: 'read_file', args_json: '{}' }],
      },
      { type: 'message', store_id: 4, role: 'tool', content: 'done', created_at: 34 },
      { type: 'session_meta', updated_at: 35, meta: { title: 'Final title' } },
    ]);

    const summary = summarizeSession(new JsonlSession({ sessionId: 'alpha', jsonlPath: path }));

    assert.deepEqual(summary, {
      id: 'alpha',
      title: 'Final title',
      durationSeconds: 24,
      messages: 3,
      userMessages: 1,
      toolCalls: 1,
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('writeExitSummary names untitled sessions with a local fallback', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-exit-summary-'));
  try {
    const path = join(workspace, '20260427_133925_30a90e.jsonl');
    await writeSessionFile(path, [
      {
        type: 'session_open',
        session_id: '20260427_133925_30a90e',
        created_at: 100,
        schema_version: 1,
        meta: { app: 'sd' },
      },
      {
        type: 'message',
        store_id: 1,
        role: 'user',
        content: 'Connection test response please',
        created_at: 101,
      },
      {
        type: 'message',
        store_id: 2,
        role: 'assistant',
        content: 'Receiving you.',
        created_at: 119,
      },
    ]);
    const session = new JsonlSession({
      sessionId: '20260427_133925_30a90e',
      jsonlPath: path,
    });
    const runtime = {
      session,
      config: { providers: { anthropic: { kind: 'anthropic', api_key_env: 'ANTHROPIC_API_KEY' } } },
      env: {},
    } as unknown as SdRuntime;
    const output = memoryOutput();

    await writeExitSummary(runtime, output.stream);

    assert.match(
      output.text(),
      /Resume this session with:\n {2}sd --session 20260427_133925_30a90e --resume/,
    );
    assert.match(output.text(), /Title\s+Connection test response please/);
    assert.match(output.text(), /Messages\s+2 \(1 user, 0 tool calls\)/);
    assert.equal(session.records().at(-1)?.type, 'session_meta');
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('writeExitSummary can use the configured title provider and model', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-title-provider-'));
  try {
    const path = join(workspace, 'alpha.jsonl');
    await writeSessionFile(path, [
      {
        type: 'session_open',
        session_id: 'alpha',
        created_at: 100,
        schema_version: 1,
        meta: { app: 'sd' },
      },
      {
        type: 'message',
        store_id: 1,
        role: 'user',
        content: 'Give this session a generated title',
        created_at: 101,
      },
    ]);
    const session = new JsonlSession({ sessionId: 'alpha', jsonlPath: path });
    const runtime = {
      session,
      config: {
        default_provider: 'mock',
        providers: { mock: { kind: 'mock', model: 'mock' } },
        sessions: {
          title: {
            enabled: true,
            provider: 'mock',
            model: 'mock-title',
            max_tokens: 12,
          },
        },
      },
      env: {},
    } as unknown as SdRuntime;
    const output = memoryOutput();

    await writeExitSummary(runtime, output.stream);

    assert.match(output.text(), /Title\s+mock response/);
    assert.deepEqual(session.records().at(-1), {
      type: 'session_meta',
      updated_at: (session.records().at(-1) as { updated_at: number }).updated_at,
      meta: {
        title: 'mock response',
        title_source: 'mock',
        title_model: 'mock-title',
      },
    });
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('renderExitSummary formats the resume command and duration', () => {
  const rendered = renderExitSummary({
    id: 'named session',
    title: 'Connection Test Response',
    durationSeconds: 64,
    messages: 2,
    userMessages: 1,
    toolCalls: 0,
  });

  assert.match(rendered, /sd --session 'named session' --resume/);
  assert.match(rendered, /Duration\s+1m 4s/);
});

test('printSessionList includes automatic session titles when available', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'snapdragon-sd-session-list-'));
  try {
    const root = join(workspace, 'sessions');
    const configPath = join(workspace, 'sd.yaml');
    await mkdir(root, { recursive: true });
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
        `  root: "${root}"`,
        '',
      ].join('\n'),
      'utf8',
    );
    await writeSessionFile(join(root, 'alpha.jsonl'), [
      {
        type: 'session_open',
        session_id: 'alpha',
        created_at: 100,
        schema_version: 1,
        meta: { title: 'Connection Test Response' },
      },
    ]);
    const output = memoryOutput();

    await printSessionList(configPath, output.stream);

    assert.match(output.text(), /alpha\t.*\t.* bytes\tConnection Test Response/);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test('formatDuration handles seconds, minutes, and hours', () => {
  assert.equal(formatDuration(19), '19s');
  assert.equal(formatDuration(125), '2m 5s');
  assert.equal(formatDuration(3700), '1h 1m');
});

async function writeSessionFile(path: string, records: Record<string, unknown>[]): Promise<void> {
  await writeFile(path, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`, 'utf8');
}

function memoryOutput(): { stream: Writable; text(): string } {
  let text = '';
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        text += chunk.toString();
        callback();
      },
    }),
    text: () => text,
  };
}
