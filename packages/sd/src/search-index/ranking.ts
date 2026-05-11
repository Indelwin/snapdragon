export const ACCESS_SCORE_WEIGHT = 0.08;
export const RECENCY_SCORE_WEIGHT = 0.12;
export const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

export function usageScore(accessCount: number): number {
  if (!Number.isFinite(accessCount) || accessCount <= 0) return 0;
  return Math.log1p(accessCount) * ACCESS_SCORE_WEIGHT;
}

export function recencyScore(lastAccessedAt: number | undefined, now = Date.now()): number {
  if (lastAccessedAt === undefined || !Number.isFinite(lastAccessedAt)) return 0;
  const ageMs = Math.max(0, now - lastAccessedAt);
  return Math.exp(-ageMs / RECENCY_HALF_LIFE_MS) * RECENCY_SCORE_WEIGHT;
}

export function usageRecencyBoost(input: {
  accessCount: number;
  lastAccessedAt: number | undefined;
  now?: number;
}): number {
  return usageScore(input.accessCount) + recencyScore(input.lastAccessedAt, input.now);
}
