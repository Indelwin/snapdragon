import type { SessionSearchHit } from '@snapdragon-ai/session';
import { formatHitTimestamp } from './session-hit-time.js';

export function formatHitsForLLM(hits: SessionSearchHit[]): string {
  if (hits.length === 0) return 'No matches.';
  const lines: string[] = [`Found ${hits.length} match(es):`];
  for (const hit of hits) lines.push(...renderHit(hit));
  return lines.join('\n');
}

function renderHit(hit: SessionSearchHit): string[] {
  const when = formatHitTimestamp(hit.createdAt);
  const session = hit.sessionId.slice(0, 24);
  return [`- [${hit.role}] ${when} ${session}`, `  ${preview(hit.content, 240)}`];
}

function preview(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

export function serializeHit(hit: SessionSearchHit) {
  return {
    session_id: hit.sessionId,
    role: hit.role,
    created_at: hit.createdAt,
    content: hit.content,
    tool_calls: hit.toolCalls,
    session_title: hit.sessionTitle,
    score: hit.score,
  };
}
