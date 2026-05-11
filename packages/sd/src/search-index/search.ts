import type { DatabaseSync } from 'node:sqlite';
import { limitFromOptions, sanitizeFtsQuery } from './query.js';
import { rowToHit } from './row.js';
import { touchEntries } from './touch.js';
import type { SdDbRow, SdIndexedKind, SdSearchHit, SdSearchOptions } from './types.js';

const RANKING_CANDIDATE_FACTOR = 4;
const RANKING_CANDIDATE_MIN = 25;

export function searchEntries(
  db: DatabaseSync,
  query: string,
  kind: SdIndexedKind,
  options: SdSearchOptions = {},
): SdSearchHit[] {
  const fts = sanitizeFtsQuery(query);
  if (fts === undefined) return [];
  const limit = limitFromOptions(options.limit, 10);
  const rows = db
    .prepare(
      `SELECT e.kind, e.id, e.title, e.description, e.body, e.tags, e.source, e.path,
              e.access_count, e.last_accessed_at, bm25(entries_fts) AS rank
       FROM entries_fts
       JOIN entries e ON e.rowid = entries_fts.rowid
       WHERE entries_fts MATCH $fts AND e.kind = $kind
       ORDER BY rank
       LIMIT $candidateLimit`,
    )
    .all({ $fts: fts, $kind: kind, $candidateLimit: rankingCandidateLimit(limit) }) as SdDbRow[];
  const hits = rows
    .map((row) => rowToHit(row, options.now))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit);
  if (options.touch === true)
    touchEntries(
      db,
      kind,
      hits.map((hit) => hit.id),
    );
  return hits;
}

function rankingCandidateLimit(limit: number): number {
  return Math.max(
    limit,
    Math.min(250, Math.max(RANKING_CANDIDATE_MIN, limit * RANKING_CANDIDATE_FACTOR)),
  );
}
