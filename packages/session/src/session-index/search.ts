import type { DatabaseSync } from 'node:sqlite';
import { buildSearchPlan, clampSearchLimit } from './search-sql.js';
import type { SessionSearchHit, SessionSearchOptions } from './types.js';

/**
 * Run a session-message search. `mode` defaults to `'fts'` (porter unicode61
 * tokenizer, good for word/phrase/AND/OR/NEAR queries). Use `'trigram'` for
 * substring or path-like queries — in that mode the input is matched as a
 * literal substring (FTS5's trigram tokenizer accepts a quoted MATCH literal).
 */
export function searchMessages(
  db: DatabaseSync,
  query: string,
  options: SessionSearchOptions = {},
): SessionSearchHit[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const limit = clampSearchLimit(options.limit);
  const plan = buildSearchPlan(trimmed, options, limit);
  const rows = db.prepare(plan.sql).all(plan.params) as RawHit[];
  return rows.map(toHit);
}

type RawHit = {
  rowid: number;
  session_id: string;
  store_id: number | null;
  role: string;
  created_at: number;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  thinking: string | null;
  session_title: string | null;
  session_updated_at: number | null;
  score: number | null;
};

function toHit(row: RawHit): SessionSearchHit {
  return {
    sessionId: row.session_id,
    rowid: row.rowid,
    storeId: row.store_id,
    role: row.role,
    createdAt: row.created_at,
    content: row.content ?? '',
    toolCalls: row.tool_calls,
    toolCallId: row.tool_call_id,
    thinking: row.thinking,
    score: row.score === null ? undefined : row.score,
    sessionTitle: row.session_title,
    sessionUpdatedAt: row.session_updated_at,
  };
}
