import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContextReadBudgetExceededError } from '../src/context-read-budget.js';
import { readCompactedContextState } from '../src/context-records.js';
import { SessionStore } from '../src/index.js';

function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), 'sd-context-archive-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return new SessionStore({ root }).create('archive');
}

test('context reads retain only the validated active rollup frontier', (t) => {
  const session = fixture(t);
  session.appendMessage({ role: 'user', content: 'old canonical' });
  let child = session.appendContextChunk({
    range_start: 1,
    range_end: 1,
    summary_text: 'leaf',
    source_token_count: 100,
    summary_token_count: 10,
    level: 'deterministic',
  });
  for (let i = 0; i < 50; i++) {
    child = session.appendContextChunk({
      range_start: 1,
      range_end: 1,
      summary_text: `rollup ${i}`,
      source_token_count: 100,
      summary_token_count: 10,
      level: 'deterministic',
      kind: 'rollup',
      depth: (child.depth ?? 0) + 1,
      child_chunks: [{ chunk_id: child.chunk_id, range_start: 1, range_end: 1 }],
    });
  }
  session.appendMessage({ role: 'user', content: 'fresh' });
  const state = readCompactedContextState(session.jsonlPath);
  assert.deepEqual(
    state.chunks.map((chunk) => chunk.chunk_id),
    [child.chunk_id],
  );
  assert.equal(state.messages.length, 1);
  assert.match(String(session.assembleContext()[0].content), /rollup 49/);
  assert.equal(session.assembleContext().at(-1)?.content, 'fresh');
});

test('streaming precompaction handles archives with no chunks and preserves canonical bytes', (t) => {
  const session = fixture(t);
  for (let i = 0; i < 192; i++) {
    session.appendMessage({ role: 'user', content: `${i}: ${'x'.repeat(64 * 1024)}` });
  }
  appendFileSync(session.jsonlPath, '{"type":"message","content":"interrupted');
  const original = readFileSync(session.jsonlPath);
  assert.throws(() => session.assembleContext(), ContextReadBudgetExceededError);
  const result = session.compactContext({ freshTailCount: 2, maxCompactionPasses: 96 });
  assert.equal(result.compacted, true);
  assert.deepEqual(readFileSync(session.jsonlPath).subarray(0, original.length), original);
  const state = readCompactedContextState(session.jsonlPath);
  assert.ok(state.messages.length < 6);
  assert.equal(state.messages.at(-1)?.store_id, 192);
  assert.ok(result.chunks.length <= state.chunks.length);
});

test('oversized fresh records fail visibly without dropping or rewriting content', (t) => {
  const session = fixture(t);
  session.appendMessage({ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) });
  const size = statSync(session.jsonlPath).size;
  for (const operation of [() => session.assembleContext(), () => session.compactContext()]) {
    assert.throws(
      operation,
      (error) =>
        error instanceof ContextReadBudgetExceededError &&
        error.code === 'CONTEXT_READ_BUDGET_EXCEEDED' &&
        error.storeId === 1,
    );
  }
  assert.equal(statSync(session.jsonlPath).size, size);
});

test('uncompacted and protected-tail reads have total budgets', (t) => {
  const session = fixture(t);
  for (let i = 0; i < 40; i++)
    session.appendMessage({ role: 'user', content: 'x'.repeat(256 * 1024) });
  assert.throws(() => session.assembleContext({ enabled: false }), ContextReadBudgetExceededError);
  assert.throws(
    () => session.compactContext({ freshTailCount: 40 }),
    ContextReadBudgetExceededError,
  );
  assert.equal(session.contextChunks().length, 0);
});

test('bounded reads count UTF-8 bytes and reject huge unterminated fresh records', (t) => {
  const session = fixture(t);
  session.appendMessage({ role: 'user', content: '\u20ac'.repeat(400_000) });
  assert.throws(() => session.assembleContext(), ContextReadBudgetExceededError);
  const other = new SessionStore({ root: join(session.jsonlPath, '..') }).create('partial');
  appendFileSync(other.jsonlPath, '{"type":"message","store_id":1,"role":"user","content":"');
  appendFileSync(other.jsonlPath, 'x'.repeat(2 * 1024 * 1024));
  assert.throws(() => other.compactContext(), ContextReadBudgetExceededError);
});

test('oversized records with reordered JSON fields cannot disappear from context', (t) => {
  const session = fixture(t);
  appendFileSync(
    session.jsonlPath,
    `${JSON.stringify({
      role: 'user',
      content: 'x'.repeat(2 * 1024 * 1024),
      type: 'message',
      store_id: 1,
      created_at: 1,
    })}\n`,
  );
  assert.throws(() => session.assembleContext(), ContextReadBudgetExceededError);
});

test('streaming batches keep assistant calls and their results in the same source range', (t) => {
  const session = fixture(t);
  const content = 'x'.repeat(64 * 1024);
  for (let i = 0; i < 32; i++) {
    session.appendMessage({ role: 'user', content });
    session.appendMessage({
      role: 'assistant',
      content,
      tool_calls: [{ id: `call-${i}`, name: 'test', arguments: '{}' }],
    });
    session.appendMessage({ role: 'tool', content, tool_call_id: `call-${i}` });
  }
  session.compactContext({ freshTailCount: 4, maxCompactionPasses: 96 });
  const chunks = session.contextChunks().filter((chunk) => chunk.kind === 'leaf');
  assert(chunks.length > 0);
  for (let i = 0; i < 32; i++) {
    const assistantId = i * 3 + 2;
    const covering = chunks.find(
      (chunk) => chunk.range_start <= assistantId && chunk.range_end >= assistantId,
    );
    if (covering) assert(covering.range_end >= assistantId + 1);
  }
  assert.equal(readCompactedContextState(session.jsonlPath).messages.at(-1)?.store_id, 96);
});
