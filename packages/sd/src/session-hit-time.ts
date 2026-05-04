/**
 * Format a session-message `created_at` timestamp for display.
 *
 * Session records store `created_at` as Unix **seconds** (see
 * `packages/session/src/session.ts`, where it's set via `Date.now() / 1000`).
 * `new Date(...)` expects milliseconds, so we scale up before formatting.
 *
 * As a defensive fallback, values that already look like milliseconds
 * (>= 1e12, i.e. anything after ~2001 in ms) are passed through as-is so a
 * caller that hands us ms doesn't render a year-50000+ string.
 */
export function formatHitTimestamp(createdAt: number | undefined | null): string {
  if (!createdAt || !Number.isFinite(createdAt)) return '';
  const ms = createdAt >= 1e12 ? createdAt : createdAt * 1000;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}
