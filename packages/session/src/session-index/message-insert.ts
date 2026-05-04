import type { DatabaseSync } from 'node:sqlite';
import type { SessionMessageRecord } from '../records.js';
import { capIndexText, flattenMessageContent, MAX_INDEX_METADATA_CHARS } from './flatten.js';

export function insertMessageRow(
  db: DatabaseSync,
  sessionId: string,
  record: SessionMessageRecord,
): void {
  const content = flattenMessageContent(record.content);
  const toolCalls = record.tool_calls
    ? capIndexText(JSON.stringify(record.tool_calls), MAX_INDEX_METADATA_CHARS)
    : null;
  const thinking = flattenThinking(record.thinking);
  db.prepare(INSERT_SQL).run({
    $sid: sessionId,
    $store: record.store_id ?? null,
    $role: record.role,
    $ts: record.created_at,
    $content: content.length > 0 ? content : null,
    $tc: toolCalls,
    $tcid: record.tool_call_id ?? null,
    $thinking: thinking,
  });
}

function flattenThinking(thinking: SessionMessageRecord['thinking']): string | null {
  if (!Array.isArray(thinking)) return null;
  const parts: string[] = [];
  for (const block of thinking) {
    if (isTextBlock(block)) parts.push(block.text);
  }
  return parts.length > 0 ? capIndexText(parts.join('\n')) : null;
}

function isTextBlock(block: unknown): block is { text: string } {
  if (!block || typeof block !== 'object') return false;
  const text = (block as { text?: unknown }).text;
  return typeof text === 'string';
}

const INSERT_SQL = `INSERT INTO messages (
  session_id, store_id, role, created_at, content, tool_calls, tool_call_id, thinking
) VALUES ($sid, $store, $role, $ts, $content, $tc, $tcid, $thinking)`;
