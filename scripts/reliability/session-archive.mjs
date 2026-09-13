import assert from 'node:assert/strict';
import { closeSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSessionFile, readMessagePreviewBatch } from '@snapdragon-ai/session';

const root = mkdtempSync(join(tmpdir(), 'sd-archive-reliability-'));
const path = join(root, 'archive.jsonl');
const count = 8192;
try {
  const fd = openSync(path, 'w');
  try {
    const append = (record) => writeSync(fd, `${JSON.stringify(record)}\n`);
    append({ type: 'session_open', session_id: 'archive', created_at: 1, schema_version: 1 });
    const content = 'x'.repeat(64 * 1024);
    for (let id = 1; id <= count; id++) {
      append({ type: 'message', store_id: id, role: 'user', content, created_at: id });
      if (id % 1024 === 0) {
        append({
          type: 'context_chunk',
          chunk_id: id / 1024,
          range_start: id - 1023,
          range_end: id,
          summary_text: `Summary through ${id}`,
          source_token_count: 1000000,
          summary_token_count: 10,
          created_at: id,
        });
      }
    }
    append({
      type: 'message',
      store_id: count + 1,
      role: 'user',
      content: 'fresh tail',
      created_at: count + 1,
    });
    writeSync(fd, '{"type":"message","content":"');
    for (let part = 0; part < 512; part++) writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  const session = openSessionFile({ sessionId: 'archive', jsonlPath: path });
  assert.equal(session.messageCount(), count + 1);
  assert.equal(session.summaryStats().messageCount, count + 1);
  const recent = session.recentMessages(2);
  assert.equal(recent.messages.at(-1).content, 'fresh tail');
  assert.equal(recent.oversizedLines, 1);
  const context = session.assembleContext();
  assert.equal(context.length, 9);
  assert.equal(context.at(-1).content, 'fresh tail');
  let cursor = { startOffset: 0, skipPartialLine: false };
  for (let batch = 0; batch < 16; batch++) {
    const next = readMessagePreviewBatch(path, { ...cursor, maxBytes: 128 * 1024, maxRecords: 4 });
    assert(next.scannedBytes <= 128 * 1024);
    assert(next.scannedRecords <= 4);
    assert(next.nextOffset > cursor.startOffset);
    cursor = { startOffset: next.nextOffset, skipPartialLine: next.skipPartialLine };
  }
  global.gc?.();
  console.log(JSON.stringify({ archiveBytes: statSync(path).size, ...process.memoryUsage() }));
  console.log('Large archive resume, summary, recent tail, and incremental scans passed.');
} finally {
  rmSync(root, { recursive: true, force: true });
}
