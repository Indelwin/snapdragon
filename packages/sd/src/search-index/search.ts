import type { DatabaseSync } from 'node:sqlite';
import { limitFromOptions, sanitizeFtsQuery } from './query.js';
import { rowToHit } from './row.js';
import { touchEntries } from './touch.js';
import type { SdDbRow, SdIndexedKind, SdSearchHit, SdSearchOptions } from './types.js';

export function searchEntries(
  db: DatabaseSync,
  query: string,
  kind: SdIndexedKind,
  options: SdSearchOptions = {},
): SdSearchHit[] {
  const fts = sanitizeFtsQuery(query);
  if (fts === undefined) return [];
  const rows = db
    .prepare(
      `SELECT e.kind, e.id, e.title, e.description, e.body, e.tags, e.source, e.path,
              e.access_count, e.last_accessed_at, bm25(entries_fts) AS rank
       FROM entries_fts
       JOIN entries e ON e.rowid = entries_fts.rowid
       WHERE entries_fts MATCH $fts AND e.kind = $kind
       ORDER BY rank
       LIMIT $limit`,
    )
    .all({ $fts: fts, $kind: kind, $limit: limitFromOptions(options.limit, 10) }) as SdDbRow[];
  const hits = rows.map(rowToHit);
  if (options.touch === true)
    touchEntries(
      db,
      kind,
      hits.map((hit) => hit.id),
    );
  return hits;
}
