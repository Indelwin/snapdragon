import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { SessionOpenRecord } from '../records.js';
import { readJsonlFromOffset } from './jsonl-tail.js';
import { partitionRecords } from './record-partition.js';
import { type FileSnapshot, listSessionFiles, removeDeletedSessions } from './session-files.js';
import {
  deleteSessionMessages,
  insertMessage,
  type SessionRow,
  selectSession,
  upsertSession,
} from './session-row.js';
import type { SessionIndexSyncResult } from './types.js';

/**
 * Walk `sessionRoot`, indexing any new or extended `*.jsonl` sessions into
 * the supplied DB. Idempotent and incremental — unchanged files are skipped,
 * and grown files are tail-read from `last_indexed_offset`.
 */
export function syncSessionRoot(db: DatabaseSync, sessionRoot: string): SessionIndexSyncResult {
  const result: SessionIndexSyncResult = {
    scanned: 0,
    newSessions: 0,
    updatedSessions: 0,
    removedSessions: 0,
    newMessages: 0,
  };
  if (!existsSync(sessionRoot)) return result;

  const onDisk = new Set<string>();
  for (const snapshot of listSessionFiles(sessionRoot)) {
    onDisk.add(snapshot.sessionId);
    result.scanned += 1;
    syncOneSession(db, snapshot, result);
  }
  removeDeletedSessions(db, onDisk, result);
  return result;
}

function syncOneSession(
  db: DatabaseSync,
  snapshot: FileSnapshot,
  result: SessionIndexSyncResult,
): void {
  const existing = selectSession(db, snapshot.sessionId);
  if (isUnchanged(existing, snapshot)) return;

  const startOffset = decideStartOffset(existing, snapshot.fileSize);
  if (startOffset === 0 && existing) {
    deleteSessionMessages(db, snapshot.sessionId);
  }

  const { records, bytesRead } = readJsonlFromOffset(snapshot.filePath, startOffset);
  const { openRecord, messageRecords, lastMessageTs } = partitionRecords(records);

  // Ensure the parent sessions row exists *before* inserting messages so the
  // FK constraint holds. Running totals are rewritten after inserts.
  const replace = startOffset === 0;
  writeSessionRow(db, snapshot, startOffset, openRecord, lastMessageTs, 0, replace);

  let inserted = 0;
  for (const record of messageRecords) {
    insertMessage(db, snapshot.sessionId, record);
    inserted += 1;
  }

  writeSessionRow(
    db,
    snapshot,
    startOffset + bytesRead,
    openRecord,
    lastMessageTs,
    inserted,
    replace,
  );

  result.newMessages += inserted;
  if (existing) result.updatedSessions += 1;
  else result.newSessions += 1;
}

function isUnchanged(existing: SessionRow | undefined, snapshot: FileSnapshot): boolean {
  return (
    !!existing &&
    existing.jsonl_size === snapshot.fileSize &&
    existing.jsonl_mtime === snapshot.fileMtime
  );
}

function decideStartOffset(existing: SessionRow | undefined, fileSize: number): number {
  const offset = existing?.last_indexed_offset ?? 0;
  // If the file shrank (truncated/rewritten) reset and reindex from scratch.
  return fileSize < offset ? 0 : offset;
}

function writeSessionRow(
  db: DatabaseSync,
  snapshot: FileSnapshot,
  lastIndexedOffset: number,
  openRecord: SessionOpenRecord | undefined,
  lastMessageTs: number | undefined,
  messageDelta: number,
  replace: boolean,
): void {
  upsertSession(db, {
    sessionId: snapshot.sessionId,
    jsonlPath: snapshot.filePath,
    jsonlSize: snapshot.fileSize,
    jsonlMtime: snapshot.fileMtime,
    lastIndexedOffset,
    openRecord,
    messageDelta,
    lastMessageTs,
    replace,
  });
}
