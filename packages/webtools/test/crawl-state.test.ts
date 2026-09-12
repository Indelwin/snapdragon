import assert from 'node:assert/strict';
import test from 'node:test';
import { CrawlStore } from '../src/crawl-state.js';
import type { CrawlStatus } from '../src/crawl-types.js';
import { WebtoolsResourceLimitError } from '../src/resource-limits.js';

test('crawl store defaults bound completed results and concurrent crawls', () => {
  const store = new CrawlStore();
  assert.equal(store.maxCompletedEntries, 32);
  assert.equal(store.maxCompletedBytes, 16 * 1024 * 1024);
  assert.equal(store.completedTtlMs, 15 * 60 * 1_000);
  assert.equal(store.maxConcurrentCrawls, 4);
});

test('crawl store retains owned snapshots without mutating returned results', () => {
  const store = new CrawlStore();
  const result = completed(store.begin('owned'), 'complete result');
  store.complete(result);

  const returnedPage = result.pages[0];
  if (!returnedPage) throw new Error('expected returned crawl page');
  returnedPage.markdown = 'caller mutation';
  const retained = store.get('owned');
  assert.equal(retained?.status, 'done');
  if (!retained || retained.status !== 'done') throw new Error('expected retained crawl');
  assert.equal(retained.pages[0]?.markdown, 'complete result');
  assert.equal(result.pages[0]?.markdown, 'caller mutation');
});

test('crawl store surfaces eviction, oversize, expiry, and deletion as not retained', () => {
  let now = 1_000;
  const store = new CrawlStore({
    maxCompletedEntries: 1,
    maxCompletedBytes: 2_000,
    completedTtlMs: 100,
    now: () => now,
  });
  const first = completed(store.begin('first'), 'first');
  store.complete(first);
  const second = completed(store.begin('second'), 'second');
  store.complete(second);
  assert.deepEqual(store.get('first'), {
    id: 'first',
    status: 'not-retained',
    reason: 'evicted',
    recordedAt: new Date(now).toISOString(),
  });

  const oversized = completed(store.begin('oversized'), 'x'.repeat(2_000));
  store.complete(oversized);
  assert.equal(oversized.pages[0]?.markdown.length, 2_000);
  assert.equal(oversized.retention, 'not-retained');
  assert.equal(oversized.retentionReason, 'result-too-large');
  assert.equal(store.get('oversized')?.status, 'not-retained');

  now += 101;
  assert.equal(store.get('second')?.status, 'not-retained');
  const deletion = completed(store.begin('delete-me'), 'delete');
  store.complete(deletion);
  assert.equal(store.delete('delete-me'), true);
  assert.equal(store.get('delete-me')?.status, 'not-retained');
});

test('crawl store rejects excess running entries and disposal releases all storage', () => {
  const store = new CrawlStore({ maxConcurrentCrawls: 1 });
  store.begin('running');
  assert.throws(
    () => store.begin('excess'),
    (error) =>
      error instanceof WebtoolsResourceLimitError && error.resource === 'concurrent crawls',
  );
  store.dispose();
  assert.deepEqual(store.diagnostics(), {
    runningCount: 0,
    completedCount: 0,
    notRetainedCount: 0,
    retainedBytes: 0,
    disposed: true,
  });
  assert.throws(() => store.get('running'), /disposed/);
});

function completed(status: CrawlStatus, markdown: string): CrawlStatus {
  status.status = 'done';
  status.finishedAt = new Date().toISOString();
  status.pagesVisited = 1;
  status.queued = 0;
  status.pages.push({
    url: 'https://example.com',
    finalUrl: 'https://example.com',
    depth: 0,
    title: 'Example',
    markdown,
    status: 200,
    source: 'fetch',
    links: [],
  });
  status.resultBytes = new TextEncoder().encode(JSON.stringify(status.pages[0])).byteLength;
  return status;
}
