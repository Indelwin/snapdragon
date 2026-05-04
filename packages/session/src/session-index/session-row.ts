import type { DatabaseSync } from 'node:sqlite';
import type { SessionMessageRecord } from '../records.js';
import { insertMessageRow } from './message-insert.js';
import { type UpsertSessionArgs, upsertSessionRow } from './session-upsert.js';

export type SessionRow = {
  jsonl_size: number;
  jsonl_mtime: number | null;
  last_indexed_offset: number;
};

export type UpsertArgs = UpsertSessionArgs;

export function selectSession(db: DatabaseSync, sessionId: string): SessionRow | undefined {
  const row = db
    .prepare(
      'SELECT jsonl_size, jsonl_mtime, last_indexed_offset FROM sessions WHERE session_id = $sid',
    )
    .get({ $sid: sessionId });
  return row as SessionRow | undefined;
}

export function deleteSessionMessages(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM messages WHERE session_id = $sid').run({ $sid: sessionId });
}

export function deleteSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE session_id = $sid').run({ $sid: sessionId });
}

export function listKnownSessionIds(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT session_id FROM sessions').all() as { session_id: string }[];
  return rows.map((row) => row.session_id);
}

export function upsertSession(db: DatabaseSync, args: UpsertArgs): void {
  upsertSessionRow(db, args);
}

export function insertMessage(
  db: DatabaseSync,
  sessionId: string,
  record: SessionMessageRecord,
): void {
  insertMessageRow(db, sessionId, record);
}
