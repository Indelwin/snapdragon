import type { SessionSearchOptions } from './types.js';

const BASE_SELECT = `
  SELECT
    m.rowid AS rowid,
    m.session_id AS session_id,
    m.store_id AS store_id,
    m.role AS role,
    m.created_at AS created_at,
    m.content AS content,
    m.tool_calls AS tool_calls,
    m.tool_call_id AS tool_call_id,
    m.thinking AS thinking,
    s.title AS session_title,
    s.updated_at AS session_updated_at
`;

export type SearchPlan = {
  sql: string;
  params: Record<string, string | number | null>;
};

export function buildSearchPlan(
  query: string,
  options: SessionSearchOptions,
  limit: number,
): SearchPlan {
  const filters: string[] = [];
  const params: Record<string, string | number | null> = { $limit: limit };
  if (options.sessionId) {
    filters.push('m.session_id = $sid');
    params.$sid = options.sessionId;
  }
  if (options.role) {
    filters.push('m.role = $role');
    params.$role = options.role;
  }
  const filterSql = filters.length > 0 ? `AND ${filters.join(' AND ')}` : '';
  const mode = options.mode ?? 'fts';
  if (mode === 'fts') {
    params.$q = options.raw ? query : sanitizeFtsQuery(query);
    return { sql: ftsSql(filterSql), params };
  }
  params.$q = `"${query.replace(/"/g, '""')}"`;
  return { sql: trigramSql(filterSql), params };
}

function ftsSql(filterSql: string): string {
  return `
    ${BASE_SELECT}, fts.rank AS score
    FROM messages_fts AS fts
    JOIN messages AS m ON m.rowid = fts.rowid
    LEFT JOIN sessions AS s ON s.session_id = m.session_id
    WHERE messages_fts MATCH $q
    ${filterSql}
    ORDER BY fts.rank
    LIMIT $limit
  `;
}

function trigramSql(filterSql: string): string {
  return `
    ${BASE_SELECT}, NULL AS score
    FROM messages_fts_trigram AS fts
    JOIN messages AS m ON m.rowid = fts.rowid
    LEFT JOIN sessions AS s ON s.session_id = m.session_id
    WHERE messages_fts_trigram MATCH $q
    ${filterSql}
    ORDER BY m.created_at DESC
    LIMIT $limit
  `;
}

const FTS_SAFE_TOKEN = /^[\p{L}\p{N}_]+$/u;
const FTS_OPERATOR_RE = /["()*^]|\bAND\b|\bOR\b|\bNOT\b|\bNEAR\b/;

function sanitizeFtsQuery(query: string): string {
  if (FTS_OPERATOR_RE.test(query)) return query;
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (FTS_SAFE_TOKEN.test(token) ? token : `"${token.replace(/"/g, '""')}"`))
    .join(' ');
}

export function clampSearchLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return 25;
  return Math.min(Math.floor(limit), 500);
}
