import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA, SCHEMA_VERSION } from './schema.js';
import { searchMessages } from './search.js';
import { syncSessionRoot } from './sync.js';
import type {
  SessionIndexSyncResult,
  SessionRowSummary,
  SessionSearchHit,
  SessionSearchOptions,
} from './types.js';

export class SdSessionIndex {
  readonly path: string;
  #db: DatabaseSync;

  private constructor(path: string, db: DatabaseSync) {
    this.path = path;
    this.#db = db;
  }

  static open(path: string): SdSessionIndex {
    if (path !== ':memory:') ensureParentDir(path);
    const db = new DatabaseSync(path);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(SCHEMA);
    db.prepare('INSERT OR REPLACE INTO schema_meta(key, value) VALUES ($k, $v)').run({
      $k: 'schema_version',
      $v: String(SCHEMA_VERSION),
    });
    return new SdSessionIndex(path, db);
  }

  close(): void {
    this.#db.close();
  }

  /** Walk a JSONL session root and bring the index up to date. */
  sync(sessionRoot: string): SessionIndexSyncResult {
    return syncSessionRoot(this.#db, sessionRoot);
  }

  /** FTS5 search across indexed messages. */
  search(query: string, options: SessionSearchOptions = {}): SessionSearchHit[] {
    return searchMessages(this.#db, query, options);
  }

  /** Drop all indexed data — caller can then `sync()` to rebuild. */
  reset(): void {
    this.#db.exec('DELETE FROM messages; DELETE FROM sessions;');
  }

  countMessages(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM messages').get() as { n: number };
    return row.n;
  }

  countSessions(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    return row.n;
  }

  listSessions(limit = 50): SessionRowSummary[] {
    const rows = this.#db
      .prepare(
        `SELECT session_id, jsonl_path, title, created_at, updated_at, message_count, jsonl_size
         FROM sessions
         ORDER BY updated_at DESC
         LIMIT $limit`,
      )
      .all({ $limit: Math.max(1, Math.min(Math.floor(limit), 1000)) }) as RawSessionRow[];
    return rows.map((row) => ({
      sessionId: row.session_id,
      jsonlPath: row.jsonl_path,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      messageCount: row.message_count,
      jsonlSize: row.jsonl_size,
    }));
  }
}

type RawSessionRow = {
  session_id: string;
  jsonl_path: string;
  title: string | null;
  created_at: number | null;
  updated_at: number | null;
  message_count: number;
  jsonl_size: number;
};

export { SCHEMA_VERSION as SESSION_INDEX_SCHEMA_VERSION } from './schema.js';
export type {
  SessionIndexSyncResult,
  SessionRowSummary,
  SessionSearchHit,
  SessionSearchMode,
  SessionSearchOptions,
} from './types.js';

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
}
