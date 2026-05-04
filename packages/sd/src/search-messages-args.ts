export const SEARCH_MODES = ['fts', 'trigram'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_ROLES = ['system', 'user', 'assistant', 'tool'] as const;
export type SearchRole = (typeof SEARCH_ROLES)[number];

export function optionalMode(value: unknown): SearchMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (SEARCH_MODES as readonly string[]).includes(value)) {
    return value as SearchMode;
  }
  throw new Error(`mode must be one of: ${SEARCH_MODES.join(', ')}`);
}

export function optionalRole(value: unknown): SearchRole | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (SEARCH_ROLES as readonly string[]).includes(value)) {
    return value as SearchRole;
  }
  throw new Error(`role must be one of: ${SEARCH_ROLES.join(', ')}`);
}

export function optionalNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('limit must be a finite number');
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}
