import { usageRecencyBoost } from './ranking.js';
import type { SdDbRow, SdSearchHit } from './types.js';

export function rowToHit(row: SdDbRow, now?: number): SdSearchHit {
  const accessCount = row.access_count;
  const lastAccessedAt = undefinedNumberIfNull(row.last_accessed_at);
  const lexicalScore = -row.rank;
  return {
    kind: row.kind,
    id: row.id,
    title: undefinedIfNull(row.title),
    description: undefinedIfNull(row.description),
    body: row.body,
    tags: parseTagText(row.tags),
    source: undefinedIfNull(row.source),
    path: row.path,
    score: lexicalScore + usageRecencyBoost({ accessCount, lastAccessedAt, now }),
    accessCount,
    lastAccessedAt,
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
