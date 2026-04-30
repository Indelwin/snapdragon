import type { DatabaseSync } from 'node:sqlite';
import type { SdIndexedKind } from './types.js';

export function touchEntries(db: DatabaseSync, kind: SdIndexedKind, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const statement = db.prepare(
    `UPDATE entries SET access_count = access_count + 1, last_accessed_at = $now
     WHERE kind = $kind AND id = $id`,
  );
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const id of ids) statement.run({ $now: now, $kind: kind, $id: id });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
