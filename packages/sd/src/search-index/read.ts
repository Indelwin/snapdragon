import type { DatabaseSync } from 'node:sqlite';
import { rowToHit } from './row.js';
import type { SdDbRow, SdIndexedKind, SdSearchHit } from './types.js';

export function getEntry(
  db: DatabaseSync,
  kind: SdIndexedKind,
  id: string,
): SdSearchHit | undefined {
  const row = db
    .prepare(
      `SELECT kind, id, title, description, body, tags, source, path, access_count, last_accessed_at, 0 AS rank
       FROM entries WHERE kind = $kind AND id = $id`,
    )
    .get({ $kind: kind, $id: id }) as SdDbRow | undefined;
  if (row === undefined) return undefined;
  return rowToHit(row);
}

export function countEntries(db: DatabaseSync, kind: SdIndexedKind): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM entries WHERE kind = $kind')
    .get({ $kind: kind }) as { n: number };
  return row.n;
}

export function inboundRefCount(db: DatabaseSync, kind: SdIndexedKind, id: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM cross_refs WHERE dst_kind = $kind AND dst_id = $id')
    .get({ $kind: kind, $id: id }) as { n: number };
  return row.n;
}
