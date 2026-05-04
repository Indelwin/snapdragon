import type { SessionSearchHit } from '@snapdragon-ai/session';

/** Render FTS hits for human display in the TUI/CLI. */
export function formatSessionSearchHits(hits: SessionSearchHit[]): string {
  if (hits.length === 0) return 'no matches';
  return hits.map(formatSessionSearchHit).join('\n');
}

export function formatSessionSearchHit(hit: SessionSearchHit): string {
  const when = formatHitTimestamp(hit.createdAt);
  const role = hit.role.padEnd(9, ' ');
  const session = hit.sessionId.slice(0, 24);
  const preview = previewText(hit.content, 200);
  return `[${role}] ${when}  ${session}\n  ${preview}`;
}

function formatHitTimestamp(createdAt: number | undefined | null): string {
  if (!createdAt) return '';
  return new Date(createdAt).toISOString().replace('T', ' ').slice(0, 19);
}

function previewText(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}
