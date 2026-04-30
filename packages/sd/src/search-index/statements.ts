import type { DatabaseSync, StatementSync } from 'node:sqlite';

export type SyncStatements = {
  select: StatementSync;
  insert: StatementSync;
  update: StatementSync;
  existingIds: StatementSync;
  remove: StatementSync;
};

export function syncStatements(db: DatabaseSync): SyncStatements {
  return {
    select: db.prepare('SELECT id, content_hash FROM entries WHERE kind = $kind AND id = $id'),
    insert: db.prepare(
      `INSERT INTO entries (kind, id, title, description, body, tags, source, path, content_hash, created_at)
       VALUES ($kind, $id, $title, $description, $body, $tags, $source, $path, $content_hash, $created_at)`,
    ),
    update: db.prepare(
      `UPDATE entries SET title = $title, description = $description, body = $body, tags = $tags, source = $source,
       path = $path, content_hash = $content_hash, created_at = $created_at
       WHERE kind = $kind AND id = $id`,
    ),
    existingIds: db.prepare('SELECT id FROM entries WHERE kind = $kind'),
    remove: db.prepare('DELETE FROM entries WHERE kind = $kind AND id = $id'),
  };
}
