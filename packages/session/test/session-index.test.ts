import { strict as assert } from 'node:assert';
import { appendFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SdSessionIndex, SessionStore } from '../src/index.ts';
import { MAX_INDEX_CONTENT_CHARS } from '../src/session-index/flatten.ts';
import { MAX_JSONL_INDEX_RECORD_BYTES } from '../src/session-index/jsonl-tail.ts';

function withRoot(): string {
  return mkdtempSync(join(tmpdir(), 'sd-session-index-'));
}

test('SdSessionIndex indexes messages and supports FTS + trigram search', () => {
  const root = withRoot();
  const store = new SessionStore({ root });
  const session = store.create('s_alpha', { title: 'Search test' });
  session.appendMessage({ role: 'user', content: 'How do I import unicode61 in fts5?' });
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Try CREATE VIRTUAL TABLE foo USING fts5(content);' }],
  });
  session.appendMessage({
    role: 'tool',
    content: [{ type: 'tool_result', content: '/Users/alice/projects/widget.ts\n' }],
    tool_call_id: 'call_1',
  });

  const index = SdSessionIndex.open(':memory:');
  const result = index.sync(root);
  assert.equal(result.newSessions, 1);
  assert.equal(result.newMessages, 3);
  assert.equal(index.countMessages(), 3);
  assert.equal(index.countSessions(), 1);

  // FTS — porter stems "import" / "imports", finds the user message.
  const ftsHits = index.search('import unicode61');
  assert.ok(ftsHits.length >= 1);
  assert.equal(ftsHits[0].sessionId, 's_alpha');
  assert.equal(ftsHits[0].role, 'user');
  assert.match(ftsHits[0].content, /unicode61/);

  // Role filter narrows to assistant.
  const assistantHits = index.search('fts5', { role: 'assistant' });
  assert.equal(assistantHits.length, 1);
  assert.equal(assistantHits[0].role, 'assistant');

  // Trigram — substring search hits the path inside the tool_result block.
  const trigramHits = index.search('widget.ts', { mode: 'trigram' });
  assert.equal(trigramHits.length, 1);
  assert.equal(trigramHits[0].role, 'tool');
  assert.match(trigramHits[0].content, /widget\.ts/);

  index.close();
});

test('SdSessionIndex sync is incremental and resilient to partial trailing writes', () => {
  const root = withRoot();
  const store = new SessionStore({ root });
  const session = store.create('s_inc');
  session.appendMessage({ role: 'user', content: 'first' });

  const index = SdSessionIndex.open(':memory:');
  let result = index.sync(root);
  assert.equal(result.newMessages, 1);

  // No-op resync.
  result = index.sync(root);
  assert.equal(result.newMessages, 0);
  assert.equal(result.scanned, 1);

  // Append more — only the new message should be indexed.
  session.appendMessage({ role: 'assistant', content: 'second' });
  session.appendMessage({ role: 'user', content: 'third' });
  result = index.sync(root);
  assert.equal(result.newMessages, 2);
  assert.equal(index.countMessages(), 3);

  // Simulate an in-flight write: append a half-line without trailing newline.
  const path = store.pathsFor('s_inc').jsonl;
  appendFileSync(path, '{"type":"message","store_id":99,"role":"user"', 'utf8');
  result = index.sync(root);
  // Partial line is left untouched; no new messages indexed.
  assert.equal(result.newMessages, 0);
  assert.equal(index.countMessages(), 3);

  // Complete the line and resync — now it should be picked up.
  appendFileSync(path, ',"content":"finished","created_at":1700000000}\n', 'utf8');
  result = index.sync(root);
  assert.equal(result.newMessages, 1);
  assert.equal(index.countMessages(), 4);

  const hits = index.search('finished');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].storeId, 99);

  index.close();
});

test('SdSessionIndex removes sessions whose JSONL was deleted', () => {
  const root = withRoot();
  const store = new SessionStore({ root });
  store.create('s_keep').appendMessage({ role: 'user', content: 'keep me' });
  store.create('s_drop').appendMessage({ role: 'user', content: 'drop me' });

  const index = SdSessionIndex.open(':memory:');
  let result = index.sync(root);
  assert.equal(result.newSessions, 2);

  store.delete('s_drop');
  result = index.sync(root);
  assert.equal(result.removedSessions, 1);
  assert.equal(index.countSessions(), 1);
  assert.equal(index.search('drop me').length, 0);
  assert.equal(index.search('keep me').length, 1);

  index.close();
});

test('SdSessionIndex stores bounded searchable previews for large message content', () => {
  const root = withRoot();
  const store = new SessionStore({ root });
  const session = store.create('s_large_preview');
  session.appendMessage({
    role: 'assistant',
    content: `needle ${'x'.repeat(MAX_INDEX_CONTENT_CHARS + 100)} tailneedle`,
  });

  const index = SdSessionIndex.open(':memory:');
  const result = index.sync(root);
  assert.equal(result.newMessages, 1);

  const hits = index.search('needle');
  assert.equal(hits.length, 1);
  assert.ok(hits[0].content.length <= MAX_INDEX_CONTENT_CHARS);
  assert.match(hits[0].content, /indexed preview truncated/);
  assert.equal(index.search('tailneedle').length, 0);

  index.close();
});

test('SdSessionIndex skips oversized JSONL records and continues after them', () => {
  const root = withRoot();
  const store = new SessionStore({ root });
  const session = store.create('s_oversize');
  const path = store.pathsFor('s_oversize').jsonl;
  appendFileSync(
    path,
    `${JSON.stringify({
      type: 'message',
      role: 'tool',
      content: 'x'.repeat(MAX_JSONL_INDEX_RECORD_BYTES + 1),
      created_at: 1700000000,
    })}\n`,
    'utf8',
  );

  const index = SdSessionIndex.open(':memory:');
  let result = index.sync(root);
  assert.equal(result.newMessages, 0);
  assert.equal(index.countMessages(), 0);

  session.appendMessage({ role: 'user', content: 'normal after oversize' });
  result = index.sync(root);
  assert.equal(result.newMessages, 1);
  assert.equal(index.search('normal after oversize').length, 1);

  index.close();
});
