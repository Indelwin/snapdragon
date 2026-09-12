import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  readMessagePreviewBatch,
  readMessagePreviews,
  readRecordStats,
  SessionStore,
} from '../src/index.ts';

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
  session.appendMeta({
    provider: 'openai-codex',
    model: 'gpt-5.5',
    provider_kind: 'openai-codex',
    cwd: '/tmp/workspace',
    profile: null,
  });

  const reopened = store.open('session_1');
  assert.equal(reopened.messages().length, 2);
  assert.equal(reopened.messageCount(), 2);
  assert.equal(reopened.assemble({ system: 'system' })[0].role, 'system');
  assert.deepEqual(reopened.messages()[1].tool_calls, [
    { id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' },
  ]);
  assert.deepEqual(reopened.metadata(), {
    provider: 'openai-codex',
    title: 'Fixture',
    model: 'gpt-5.5',
    provider_kind: 'openai-codex',
    cwd: '/tmp/workspace',
    profile: null,
  });
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

test('JSONL session stats avoid full record parsing on open', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_stats');
  session.appendMessage({ role: 'user', content: 'hello' });
  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify({
      type: 'message',
      store_id: 99,
      role: 'assistant',
      content: 'x'.repeat(500_000),
      created_at: 2,
    })}\n`,
    'utf8',
  );

  const stats = readRecordStats(session.jsonlPath);
  const reopened = store.open('session_stats');
  const summary = reopened.summaryStats();
  assert.equal(stats.nextStoreId, 100);
  assert.equal(reopened.messageCount(), 2);
  assert.equal(summary.lastMessageAt, 2);
  assert.equal(summary.messageCount, 2);
});

test('JSONL session stats ignore record-like content and malformed prefixes', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_stats_envelope', {
    note: 'embedded {"type":"message","store_id":900} text',
  });
  session.appendMessage({ role: 'user', content: 'real message' });
  appendFileSync(
    session.jsonlPath,
    '{"type":"message","store_id":900,"role":"user",not-valid-json}\n',
  );

  const reopened = store.open(session.sessionId);
  assert.equal(reopened.messageCount(), 1);
  assert.equal(reopened.appendMessage({ role: 'user', content: 'next message' }).store_id, 2);
});

test('JSONL sessions read bounded recent messages without loading all records', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_recent');
  for (let index = 0; index < 20; index += 1) {
    session.appendMessage({ role: 'user', content: `message ${index}` });
  }
  appendFileSync(session.jsonlPath, '{"type": "message"\n', 'utf8');

  const reopened = store.open('session_recent');
  const recent = reopened.recentMessages(5);

  assert.equal(recent.omitted, 15);
  assert.deepEqual(
    recent.messages.map((message) => message.content),
    ['message 15', 'message 16', 'message 17', 'message 18', 'message 19'],
  );
  assert.equal(reopened.recentMessages(0).messages.length, 0);
});

test('recent messages skip bounded oversized and unterminated tail records', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_recent_oversized');
  session.appendMessage({ role: 'user', content: 'retained before oversized records' });
  session.appendMessage({ role: 'assistant', content: 'x'.repeat(600_000) });
  appendFileSync(
    session.jsonlPath,
    `{"type":"message","store_id":3,"role":"user","content":"${'y'.repeat(600_000)}`,
  );

  const recent = session.recentMessages(2);

  assert.deepEqual(
    recent.messages.map((message) => message.content),
    ['retained before oversized records'],
  );
  assert.equal(recent.oversizedLines, 2);
  assert.equal(recent.omitted, 1);
});

test('JSONL session full-record reads do not retain stale in-memory history', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_fresh_reads');
  session.appendMessage({ role: 'user', content: 'first' });

  assert.equal(session.records().filter((record) => record.type === 'message').length, 1);

  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify({
      type: 'message',
      store_id: 2,
      role: 'assistant',
      content: 'second',
      created_at: 2,
    })}\n`,
    'utf8',
  );

  assert.equal(session.records().filter((record) => record.type === 'message').length, 2);
  assert.equal(session.messageCount(), 2);
});

test('message preview reader skips large tool payloads without dropping adjacent messages', async () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_preview');
  session.appendMessage({ role: 'user', content: 'remember to keep previews light' });
  session.appendMessage({
    role: 'assistant',
    content: 'using a tool',
    tool_calls: [{ id: 'call_1', name: 'run_shell', args_json: '{"cmd":"npm test"}' }],
  });
  session.appendMessage({
    role: 'tool',
    content: 'x'.repeat(900_000),
    tool_call_id: 'call_1',
  });

  const previews = await readMessagePreviews(session.jsonlPath, {
    roles: ['user', 'assistant'],
    includeContent: true,
    includeToolCalls: true,
    maxContentChars: 80,
  });

  assert.deepEqual(
    previews.map((preview) => preview.role),
    ['user', 'assistant'],
  );
  assert.equal(previews[0]?.contentText, 'remember to keep previews light');
  assert.equal(previews[1]?.tool_calls?.[0]?.name, 'run_shell');
});

test('message preview batches advance byte watermarks within total record budgets', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_preview_batches');
  for (let index = 0; index < 7; index += 1) {
    session.appendMessage({ role: 'user', content: `batch message ${index}` });
  }

  let offset = 0;
  let skipPartialLine = false;
  const seen: string[] = [];
  let passes = 0;
  for (;;) {
    const batch = readMessagePreviewBatch(session.jsonlPath, {
      startOffset: offset,
      skipPartialLine,
      maxRecords: 3,
      maxBytes: 512,
      roles: ['user'],
      includeContent: true,
    });
    assert.ok(batch.scannedRecords <= 3);
    assert.ok(batch.nextOffset >= offset);
    seen.push(...batch.records.map((record) => record.contentText ?? ''));
    offset = batch.nextOffset;
    skipPartialLine = batch.skipPartialLine;
    passes += 1;
    if (batch.done) break;
    assert.ok(batch.scannedRecords > 0);
  }

  assert.ok(passes > 1);
  assert.deepEqual(
    seen,
    Array.from({ length: 7 }, (_, index) => `batch message ${index}`),
  );
});

test('message preview batches enforce byte budgets across oversized records', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_oversized_preview');
  session.appendMessage({ role: 'user', content: 'x'.repeat(512 * 1024) });
  session.appendMessage({ role: 'user', content: 'visible after oversized record' });

  let offset = 0;
  let skipPartialLine = false;
  let passes = 0;
  const seen: string[] = [];
  for (;;) {
    const batch = readMessagePreviewBatch(session.jsonlPath, {
      startOffset: offset,
      skipPartialLine,
      maxBytes: 16 * 1024,
      roles: ['user'],
      includeContent: true,
    });
    assert.ok(batch.scannedBytes <= 16 * 1024);
    assert.ok(batch.nextOffset > offset || batch.done);
    seen.push(...batch.records.map((record) => record.contentText ?? ''));
    offset = batch.nextOffset;
    skipPartialLine = batch.skipPartialLine;
    passes += 1;
    if (batch.done) break;
    assert.ok(passes < 100);
  }

  assert.ok(passes > 20);
  assert.deepEqual(seen, ['visible after oversized record']);
});

test('message preview batches advance once across an unterminated oversized line', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapdragon-session-'));
  const path = join(root, 'unterminated.jsonl');
  appendFileSync(path, `{"type":"message","content":"${'x'.repeat(512 * 1024)}`);

  let offset = 0;
  let skipPartialLine = false;
  let passes = 0;
  for (;;) {
    const batch = readMessagePreviewBatch(path, {
      startOffset: offset,
      skipPartialLine,
      maxBytes: 16 * 1024,
      includeContent: true,
    });
    assert.ok(batch.scannedBytes <= 16 * 1024);
    assert.ok(batch.nextOffset > offset || batch.done);
    offset = batch.nextOffset;
    skipPartialLine = batch.skipPartialLine;
    passes += 1;
    if (batch.done) break;
    assert.ok(passes < 100);
  }
  assert.equal(skipPartialLine, true);

  appendFileSync(
    path,
    `\n${JSON.stringify({
      type: 'message',
      store_id: 2,
      created_at: 2,
      role: 'user',
      content: 'record after unterminated line',
    })}\n`,
  );
  const resumed = readMessagePreviewBatch(path, {
    startOffset: offset,
    skipPartialLine,
    maxBytes: 16 * 1024,
    roles: ['user'],
    includeContent: true,
  });
  assert.ok(resumed.scannedBytes <= 16 * 1024);
  assert.deepEqual(
    resumed.records.map((record) => record.contentText),
    ['record after unterminated line'],
  );
  assert.equal(resumed.skipPartialLine, false);
  assert.equal(resumed.done, true);
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
  assert.equal(
    session.compactContext({
      freshTailCount: 2,
      chunkTargetTokens: 100,
      summaryTargetTokens: 12,
      minChunkMessages: 2,
      maxRequestTokens: 40,
    }).compacted,
    false,
    'a later compaction pass must preserve the existing fresh tail',
  );
});

test('JSONL context compaction rolls leaf summaries into an active hierarchy', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_rollup');
  for (let index = 0; index < 30; index += 1) {
    session.appendMessage({ role: 'user', content: `historical ${index} ${'x'.repeat(180)}` });
  }

  const result = session.compactContext({
    freshTailCount: 2,
    chunkTargetTokens: 120,
    summaryTargetTokens: 20,
    minChunkMessages: 1,
    maxRequestTokens: 80,
    maxCompactionPasses: 96,
  });
  const archive = session.contextChunks();
  const rollups = archive.filter((chunk) => chunk.kind === 'rollup');
  const assembled = session.assembleContext({ freshTailCount: 2 });

  assert.equal(result.compacted, true);
  assert.ok(rollups.length > 0);
  assert.ok(archive.some((chunk) => chunk.kind === 'leaf'));
  assert.ok(
    rollups.every((chunk) =>
      chunk.child_chunks?.every((child) =>
        archive.some(
          (candidate) =>
            candidate.chunk_id === child.chunk_id &&
            candidate.range_start === child.range_start &&
            candidate.range_end === child.range_end,
        ),
      ),
    ),
  );
  assert.ok(assembled.length < archive.length + 2);
  assert.deepEqual(
    assembled.slice(-2).map((message) => message.content),
    session
      .messages()
      .slice(-2)
      .map((message) => message.content),
  );
});

test('context pressure rolls up summaries when stale leaf candidates are below minimum', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_rollup_tiny_candidate');
  for (let index = 1; index <= 6; index += 1) {
    session.appendMessage({ role: 'user', content: `canonical ${index}` });
  }
  session.appendContextChunk(contextLeaf(1, 2, `first ${'x'.repeat(1_000)}`));
  session.appendContextChunk(contextLeaf(3, 4, `second ${'y'.repeat(1_000)}`));

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 200,
    summaryTargetTokens: 10,
    minChunkMessages: 2,
    maxRequestTokens: 40,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.chunks[0]?.kind, 'rollup');
  assert.deepEqual(
    session
      .assembleContext({ freshTailCount: 1 })
      .slice(-1)
      .map((message) => message.content),
    ['canonical 6'],
  );
});

test('context pressure rolls up summaries when the selected leaf is not smaller', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_rollup_no_smaller_leaf');
  for (let index = 1; index <= 6; index += 1) {
    session.appendMessage({ role: 'user', content: index === 5 ? 'x' : `canonical ${index}` });
  }
  session.appendContextChunk(contextLeaf(1, 2, `first ${'x'.repeat(1_000)}`));
  session.appendContextChunk(contextLeaf(3, 4, `second ${'y'.repeat(1_000)}`));

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 200,
    summaryTargetTokens: 10,
    minChunkMessages: 1,
    maxRequestTokens: 40,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.chunks[0]?.kind, 'rollup');
  assert.equal(result.chunks[0]?.range_end, 4);
});

test('context pressure can shrink a single oversized active summary', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_single_summary_rollup');
  session.appendMessage({ role: 'user', content: 'historical' });
  session.appendMessage({ role: 'user', content: 'fresh tail' });
  const leaf = session.appendContextChunk(contextLeaf(1, 1, 'x'.repeat(4_000)));

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 2_000,
    summaryTargetTokens: 20,
    minChunkMessages: 1,
    maxRequestTokens: 120,
  });

  assert.equal(result.compacted, true);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0]?.kind, 'rollup');
  assert.deepEqual(result.chunks[0]?.child_chunks, [
    { chunk_id: leaf.chunk_id, range_start: 1, range_end: 1 },
  ]);
  assert.equal(session.assembleContext({ freshTailCount: 1 }).at(-1)?.content, 'fresh tail');
});

test('single-summary compaction stops when its rendered replacement is not smaller', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_single_summary_no_progress');
  session.appendMessage({ role: 'user', content: 'historical' });
  session.appendMessage({ role: 'user', content: 'fresh tail' });
  session.appendContextChunk(contextLeaf(1, 1, 'already small'));

  const result = session.compactContext({
    freshTailCount: 1,
    chunkTargetTokens: 100,
    summaryTargetTokens: 10,
    minChunkMessages: 1,
    maxRequestTokens: 1,
    maxCompactionPasses: 96,
  });

  assert.equal(result.compacted, false);
  assert.equal(result.reason, 'no_smaller');
  assert.equal(session.contextChunks().length, 1);
});

test('context frontier rejects dangling, overlapping, and regressing chunks', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_context_corruption');
  for (let index = 1; index <= 5; index += 1) {
    session.appendMessage({ role: 'user', content: `canonical ${index}` });
  }
  const first = session.appendContextChunk(contextLeaf(1, 2, 'first valid leaf'));
  const second = session.appendContextChunk(contextLeaf(3, 4, 'second valid leaf'));

  assert.throws(
    () =>
      session.appendContextChunk({
        ...contextLeaf(1, 4, 'bad writer rollup'),
        kind: 'rollup',
        depth: 1,
        child_chunks: [
          { chunk_id: first.chunk_id, range_start: 1, range_end: 1 },
          { chunk_id: second.chunk_id, range_start: 3, range_end: 4 },
        ],
      }),
    /active append-only frontier/,
  );
  assert.throws(
    () => session.appendContextChunk(contextLeaf(4, 5, 'overlapping writer leaf')),
    /active append-only frontier/,
  );

  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify({
      ...contextChunkRecord(3, 1, 4, 'dangling rollup'),
      kind: 'rollup',
      depth: 1,
      child_chunks: [
        { chunk_id: first.chunk_id, range_start: 1, range_end: 2 },
        { chunk_id: 999, range_start: 3, range_end: 4 },
      ],
    })}\n`,
  );
  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify(contextChunkRecord(4, 2, 5, 'overlapping leaf'))}\n`,
  );
  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify(contextChunkRecord(1, 5, 5, 'regressing chunk id'))}\n`,
  );
  appendFileSync(session.jsonlPath, '{"type":"context_chunk","chunk_id":5');

  const assembled = session.assembleContext({ enabled: true, freshTailCount: 1 });
  assert.equal(assembled.length, 3);
  assert.match(String(assembled[0].content), /first valid leaf/);
  assert.match(String(assembled[1].content), /second valid leaf/);
  assert.equal(assembled[2].content, 'canonical 5');
});

test('context frontier rejects leaf gaps without hiding uncovered canonical messages', () => {
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-session-')) });
  const session = store.create('session_context_gap');
  for (let index = 1; index <= 3; index += 1) {
    session.appendMessage({ role: 'user', content: `canonical ${index}` });
  }
  session.appendContextChunk(contextLeaf(1, 1, 'first valid leaf'));
  assert.throws(
    () => session.appendContextChunk(contextLeaf(3, 3, 'writer gap')),
    /active append-only frontier/,
  );
  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify(contextChunkRecord(2, 3, 3, 'corrupt gap leaf'))}\n`,
  );

  const assembled = session.assembleContext({ enabled: true, freshTailCount: 1 });

  assert.equal(assembled.length, 3);
  assert.match(String(assembled[0]?.content), /first valid leaf/);
  assert.deepEqual(
    assembled.slice(1).map((message) => message.content),
    ['canonical 2', 'canonical 3'],
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

test('JSONL context assembly skips compacted message bodies without parsing them', () => {
  const root = mkdtempSync(join(tmpdir(), 'snapdragon-session-'));
  const store = new SessionStore({ root });
  const session = store.create('session_compacted_read');
  session.appendMessage({ role: 'user', content: 'old huge message' });
  session.appendContextChunk({
    range_start: 1,
    range_end: 1,
    summary_text: 'old summary',
    source_token_count: 1000,
    summary_token_count: 3,
    level: 'deterministic',
    created_by_model: null,
  });
  appendFileSync(
    join(root, 'session_compacted_read.jsonl'),
    '{"type":"message","store_id":1,"role":"tool","content":\n',
    'utf8',
  );
  session.appendMessage({ role: 'user', content: 'fresh tail' });

  const assembled = session.assembleContext({ freshTailCount: 1 });

  assert.match(String(assembled[0].content), /Context summary for earlier canonical messages 1-1/);
  assert.match(String(assembled[0].content), /old summary/);
  assert.equal(assembled[1].content, 'fresh tail');
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

function contextLeaf(rangeStart: number, rangeEnd: number, summaryText: string) {
  return {
    range_start: rangeStart,
    range_end: rangeEnd,
    summary_text: summaryText,
    source_token_count: 20,
    summary_token_count: 5,
    level: 'deterministic' as const,
    kind: 'leaf' as const,
    depth: 0,
    created_by_model: null,
  };
}

function contextChunkRecord(
  chunkId: number,
  rangeStart: number,
  rangeEnd: number,
  summaryText: string,
) {
  return {
    type: 'context_chunk',
    chunk_id: chunkId,
    range_start: rangeStart,
    range_end: rangeEnd,
    summary_text: summaryText,
    source_token_count: 20,
    summary_token_count: 5,
    created_at: 1,
    level: 'deterministic',
    kind: 'leaf',
    depth: 0,
    created_by_model: null,
  };
}
