import type { SdDbRow, SdSearchHit } from './types.js';

export function rowToHit(row: SdDbRow): SdSearchHit {
  return {
    kind: row.kind,
    id: row.id,
    title: undefinedIfNull(row.title),
    description: undefinedIfNull(row.description),
    body: row.body,
    tags: parseTagText(row.tags),
    source: undefinedIfNull(row.source),
    path: row.path,
    score: -row.rank,
    accessCount: row.access_count,
    lastAccessedAt: undefinedNumberIfNull(row.last_accessed_at),
  };
}

function undefinedIfNull(value: string | null): string | undefined {
  if (value === null) return undefined;
  return value;
}

function undefinedNumberIfNull(value: number | null): number | undefined {
  if (value === null) return undefined;
  return value;
}

function parseTagText(value: string | null): string[] {
  if (value === null) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}
