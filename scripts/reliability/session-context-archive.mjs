import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  createReadStream,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContextReadBudgetExceededError,
  estimateMessagesTokens,
  openSessionFile,
} from '@snapdragon-ai/session';

const root = mkdtempSync(join(tmpdir(), 'sd-context-heap-'));
try {
  await uncompactedArchive();
  supersededSummaries();
  oversizedFreshRecord();
  console.log(
    'Bounded context precompaction, active frontier, and oversized-record errors passed.',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

async function uncompactedArchive() {
  const path = join(root, 'raw.jsonl');
  writeFixture(path, (fd) => {
    const content = 'x'.repeat(64 * 1024);
    for (let id = 1; id <= 8192; id++) append(fd, message(id, content));
    append(fd, message(8193, 'fresh tail'));
  });
  const bytes = statSync(path).size;
  const digest = await hashPrefix(path, bytes);
  const session = openSessionFile({ sessionId: 'raw', jsonlPath: path });
  assert.throws(() => session.assembleContext(), ContextReadBudgetExceededError);
  session.compactContext({ freshTailCount: 2, maxCompactionPasses: 96 });
  const context = session.assembleContext({ freshTailCount: 2 });
  assert.equal(context.at(-1).content, 'fresh tail');
  assert.equal(context.at(-2).content.length, 64 * 1024);
  assert(estimateMessagesTokens(context) <= 120_000);
  assert.equal(await hashPrefix(path, bytes), digest, 'canonical bytes must remain unchanged');
  report('no-existing-chunks', bytes);
}

function supersededSummaries() {
  const path = join(root, 'rollups.jsonl');
  writeFixture(path, (fd) => {
    append(fd, message(1, 'original canonical message'));
    const summary = 'summary '.repeat(8192);
    for (let id = 1; id <= 4096; id++) {
      append(fd, {
        type: 'context_chunk',
        chunk_id: id,
        range_start: 1,
        range_end: 1,
        summary_text: `${id} ${summary}`,
        source_token_count: 100000,
        summary_token_count: 20000,
        created_at: id,
        kind: id === 1 ? 'leaf' : 'rollup',
        depth: id - 1,
        ...(id > 1 ? { child_chunks: [{ chunk_id: id - 1, range_start: 1, range_end: 1 }] } : {}),
      });
    }
    append(fd, message(2, 'fresh after rollups'));
  });
  const session = openSessionFile({ sessionId: 'rollups', jsonlPath: path });
  const context = session.assembleContext();
  assert.equal(context.length, 2);
  assert.match(context[0].content, /4096 summary/);
  assert.equal(context[1].content, 'fresh after rollups');
  report('superseded-summaries', statSync(path).size);
}

function oversizedFreshRecord() {
  const path = join(root, 'oversized.jsonl');
  writeFixture(path, (fd) => {
    writeSync(fd, '{"type":"message","store_id":1,"role":"user","content":"');
    const piece = 'x'.repeat(64 * 1024);
    for (let i = 0; i < 4096; i++) writeSync(fd, piece);
    writeSync(fd, '","created_at":1}\n');
  });
  const session = openSessionFile({ sessionId: 'oversized', jsonlPath: path });
  const bytes = statSync(path).size;
  assert.throws(() => session.compactContext(), ContextReadBudgetExceededError);
  assert.throws(() => session.assembleContext(), ContextReadBudgetExceededError);
  assert.equal(statSync(path).size, bytes);
  report('oversized-fresh-record', bytes);
}

function writeFixture(path, write) {
  const fd = openSync(path, 'w');
  try {
    append(fd, { type: 'session_open', session_id: 'archive', created_at: 1, schema_version: 1 });
    write(fd);
  } finally {
    closeSync(fd);
  }
}

function append(fd, record) {
  writeSync(fd, `${JSON.stringify(record)}\n`);
}

function message(id, content) {
  return { type: 'message', store_id: id, role: 'user', content, created_at: id };
}

async function hashPrefix(path, bytes) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { start: 0, end: bytes - 1 }))
    hash.update(chunk);
  return hash.digest('hex');
}

function report(probe, archiveBytes) {
  global.gc?.();
  console.log(JSON.stringify({ probe, archiveBytes, ...process.memoryUsage() }));
}
