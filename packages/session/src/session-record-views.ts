import type { SessionContextChunkRecord, SessionMessageRecord, SessionRecord } from './records.js';

export function nextStoreId(records: SessionRecord[]): number {
  let next = 1;
  for (const record of records) {
    if (record.type === 'message') next = Math.max(next, record.store_id + 1);
  }
  return next;
}

export function nextChunkId(records: SessionRecord[]): number {
  let next = 1;
  for (const record of records) {
    if (record.type === 'context_chunk') next = Math.max(next, record.chunk_id + 1);
  }
  return next;
}

export function messageRecords(records: SessionRecord[]): SessionMessageRecord[] {
  return records.filter((record): record is SessionMessageRecord => record.type === 'message');
}

export function contextChunks(records: SessionRecord[]): SessionContextChunkRecord[] {
  return records.filter(
    (record): record is SessionContextChunkRecord => record.type === 'context_chunk',
  );
}
