export const SCHEMA_VERSION = 1;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  body TEXT NOT NULL,
  tags TEXT,
  source TEXT,
  path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER,
  PRIMARY KEY (kind, id)
);

CREATE INDEX IF NOT EXISTS entries_kind_idx ON entries(kind);
CREATE INDEX IF NOT EXISTS entries_path_idx ON entries(path);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  title, description, body, tags,
  content='entries',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS entries_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, description, body, tags)
  VALUES (new.rowid, new.title, new.description, new.body, new.tags);
END;
CREATE TRIGGER IF NOT EXISTS entries_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, description, body, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.body, old.tags);
END;
CREATE TRIGGER IF NOT EXISTS entries_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, description, body, tags)
  VALUES ('delete', old.rowid, old.title, old.description, old.body, old.tags);
  INSERT INTO entries_fts(rowid, title, description, body, tags)
  VALUES (new.rowid, new.title, new.description, new.body, new.tags);
END;

CREATE TABLE IF NOT EXISTS cross_refs (
  src_kind TEXT NOT NULL,
  src_id TEXT NOT NULL,
  dst_kind TEXT NOT NULL,
  dst_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  PRIMARY KEY (src_kind, src_id, dst_kind, dst_id, rel)
);

CREATE INDEX IF NOT EXISTS cross_refs_dst_idx ON cross_refs(dst_kind, dst_id);
`;
