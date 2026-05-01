import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionStore } from '../src/index.ts';

test('JSONL sessions create, append, reopen, assemble, and delete', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_1', { provider: 'mock' });

  session.appendMessage({
    role: 'user',
    content: [
      { type: 'text', text: 'describe' },
      { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
    ],
  });
  session.appendMessage({
    role: 'assistant',
    content: 'calling',
    tool_calls: [{ id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' }],
    thinking: [{ text: 'think', signature: 'sig_1' }],
  });
  session.appendMeta({ title: 'Fixture' });

  const reopened = store.open('session_1');
  assert.equal(reopened.messages().length, 2);
  assert.equal(reopened.messageCount(), 2);
  assert.equal(reopened.assemble({ system: 'system' })[0].role, 'system');
  assert.deepEqual(reopened.messages()[1].tool_calls, [
    { id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' },
  ]);
  assert.equal(store.list()[0].session_id, 'session_1');
  assert.equal(store.delete('session_1'), true);
  assert.equal(store.exists('session_1'), false);
});

test('JSONL context summaries preview huge single-line tool output without copying it', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_huge_tool');
  session.appendMessage({
    role: 'user',
    content: 'x'.repeat(100_000),
  });
  session.appendMessage({ role: 'user', content: 'fresh' });

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 100,
    summaryTargetTokens: 100,
    minChunkMessages: 1,
    maxRequestTokens: 50,
  });

  assert.equal(result.compacted, true);
  assert.ok(result.chunks[0].summary_text.length < 600);
  assert.match(result.chunks[0].summary_text, /truncated/);
  assert.equal(session.messageCount(), 2);
});

test('JSONL sessions skip malformed trailing lines', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_2');
  session.appendMessage({ role: 'user', content: 'hello' });
  appendFileSync(session.jsonlPath, '{"type": "message"\n', 'utf8');

  assert.equal(store.open('session_2').messages().length, 1);
});

test('JSONL sessions compact older messages into append-only context chunks', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_3');
  for (let index = 0; index < 8; index += 1) {
    session.appendMessage({
      role: 'user',
      content: `message ${index + 1} ${'x'.repeat(120)}`,
    });
  }

  const result = session.compactContext({
    freshTailCount: 2,
    chunkTargetTokens: 100,
    summaryTargetTokens: 12,
    minChunkMessages: 2,
    maxRequestTokens: 40,
  });
  const assembled = session.assembleContext({ freshTailCount: 2 });

  assert.equal(result.compacted, true);
  assert.ok(session.contextChunks().length > 0);
  assert.equal(session.messages().length, 8);
  assert.match(String(assembled[0].content), /Context summary for earlier canonical messages/);
  assert.deepEqual(
    assembled.slice(-2).map((message) => message.content),
    [session.messages()[6].content, session.messages()[7].content],
  );
});

test('JSONL context compaction keeps assistant tool calls with tool results', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_4');
  session.appendMessage({ role: 'user', content: 'please read' });
  session.appendMessage({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call_1', name: 'read_file', args_json: '{"path":"README.md"}' }],
  });
  session.appendMessage({
    role: 'tool',
    content: 'file output '.repeat(80),
    tool_call_id: 'call_1',
  });
  session.appendMessage({ role: 'user', content: 'fresh 1' });
  session.appendMessage({ role: 'assistant', content: 'fresh 2' });

  const result = session.compactContext({
    freshTailCount: 2,
    chunkTargetTokens: 60,
    summaryTargetTokens: 10,
    minChunkMessages: 2,
    maxRequestTokens: 20,
  });

  assert.equal(result.chunks[0].range_start, 1);
  assert.equal(result.chunks[0].range_end, 3);
});

test('JSONL context compaction avoids splitting tool calls across the fresh tail', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_5');
  session.appendMessage({ role: 'user', content: 'old context '.repeat(80) });
  session.appendMessage({
    role: 'assistant',
    content: '',
    tool_calls: [{ id: 'call_tail', name: 'read_file', args_json: '{"path":"README.md"}' }],
  });
  session.appendMessage({
    role: 'tool',
    content: 'protected tail result',
    tool_call_id: 'call_tail',
  });

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 80,
    summaryTargetTokens: 10,
    minChunkMessages: 1,
    maxRequestTokens: 20,
  });

  assert.equal(result.chunks[0].range_start, 1);
  assert.equal(result.chunks[0].range_end, 1);
});
