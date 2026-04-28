import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Message } from '@snapdragon-ai/host';

export const SESSION_SCHEMA_VERSION = 1;

export interface SessionOpenRecord {
  type: 'session_open';
  session_id: string;
  created_at: number;
  schema_version: number;
  meta?: Record<string, unknown>;
}

export interface SessionMessageRecord {
  type: 'message';
  store_id: number;
  role: Message['role'];
  content: Message['content'];
  tool_call_id?: string;
  tool_calls?: Message['tool_calls'];
  thinking?: Message['thinking'];
  created_at: number;
  meta?: Record<string, unknown>;
}

export interface SessionMetaRecord {
  type: 'session_meta';
  updated_at: number;
  meta: Record<string, unknown>;
}

export interface SessionContextChunkRecord {
  type: 'context_chunk';
  chunk_id: number;
  range_start: number;
  range_end: number;
  summary_text: string;
  source_token_count: number;
  summary_token_count: number;
  created_at: number;
  level?: 'deterministic' | 'summary';
  created_by_model?: string | null;
  meta?: Record<string, unknown>;
}

export type SessionRecord =
  | SessionOpenRecord
  | SessionMessageRecord
  | SessionMetaRecord
  | SessionContextChunkRecord;

export function appendRecord(path: string, record: SessionRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readRecords(path: string): SessionRecord[] {
  if (!existsSync(path)) return [];
  const out: SessionRecord[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseRecord(trimmed);
    if (record) out.push(record);
  }
  return out;
}

function parseRecord(line: string): SessionRecord | undefined {
  try {
    return JSON.parse(line) as SessionRecord;
  } catch {
    return undefined;
  }
}
