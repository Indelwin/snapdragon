import type { DatabaseSync } from 'node:sqlite';
import type { ExistingSessionRow, UpsertSessionArgs } from './session-upsert-types.js';
import { buildUpsertParams } from './session-upsert-values.js';

export type { UpsertSessionArgs } from './session-upsert-types.js';

export function upsertSessionRow(db: DatabaseSync, args: UpsertSessionArgs): void {
  const existing = readExisting(db, args.sessionId);
  db.prepare(UPSERT_SQL).run(buildUpsertParams(existing, args));
}

function readExisting(db: DatabaseSync, sessionId: string): ExistingSessionRow | undefined {
  return db
    .prepare('SELECT message_count, created_at, title FROM sessions WHERE session_id = $sid')
    .get({ $sid: sessionId }) as ExistingSessionRow | undefined;
}

const UPSERT_SQL = `INSERT INTO sessions (
   session_id, jsonl_path, created_at, updated_at, title,
   message_count, jsonl_size, jsonl_mtime, last_indexed_offset
 ) VALUES (
   $sid, $path, $created, $updated, $title,
   $count, $size, $mtime, $offset
 )
 ON CONFLICT(session_id) DO UPDATE SET
   jsonl_path = excluded.jsonl_path,
   created_at = COALESCE(sessions.created_at, excluded.created_at),
   updated_at = excluded.updated_at,
   title = COALESCE(excluded.title, sessions.title),
   message_count = excluded.message_count,
   jsonl_size = excluded.jsonl_size,
   jsonl_mtime = excluded.jsonl_mtime,
   last_indexed_offset = excluded.last_indexed_offset`;
