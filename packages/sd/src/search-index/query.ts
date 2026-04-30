export function sanitizeFtsQuery(query: string): string | undefined {
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, ''))
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return undefined;
  return tokens.map((token) => `"${token.replace(/"/g, '""')}"*`).join(' OR ');
}

export function limitFromOptions(limit: number | undefined, fallback: number): number {
  if (limit === undefined) return fallback;
  return limit;
}
