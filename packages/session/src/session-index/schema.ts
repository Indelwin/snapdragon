export const SCHEMA_VERSION = 1;

/**
 * Global session-search index. Lives in a sidecar SQLite DB next to the
 * session JSONL root (e.g. `~/.snapdragon/sessions.index.sqlite`). The JSONL
 * files remain the source of truth; this index is rebuildable from them.
 *
 * Two FTS5 virtual tables, mirroring the hermes design:
 *   - `messages_fts`         tokenize='porter unicode61'  (word search)
 *   - `messages_fts_trigram` tokenize='trigram'           (substring/path search)
 *
 * `sessions.last_indexed_offset` lets `sync()` tail-read JSONL files
 * incrementally instead of re-parsing on every call.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  jsonl_path TEXT NOT NULL,
  created_at REAL,
  updated_at REAL,
  title TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  jsonl_size INTEGER NOT NULL DEFAULT 0,
  jsonl_mtime REAL,
  last_indexed_offset INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  rowid INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  store_id INTEGER,
  role TEXT NOT NULL,
  created_at REAL NOT NULL,
  content TEXT,
  tool_calls TEXT,
  tool_call_id TEXT,
  thinking TEXT
);

CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS messages_role_idx ON messages(role);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  tool_calls,
  thinking,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
  content,
  tool_calls,
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, tool_calls, thinking)
  VALUES (new.rowid, new.content, new.tool_calls, new.thinking);
  INSERT INTO messages_fts_trigram(rowid, content, tool_calls)
  VALUES (new.rowid, COALESCE(new.content, '') || ' ' || COALESCE(new.tool_call_id, ''), new.tool_calls);
END;

CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content, tool_calls, thinking)
  VALUES ('delete', old.rowid, old.content, old.tool_calls, old.thinking);
  DELETE FROM messages_fts_trigram WHERE rowid = old.rowid;
END;
`;
