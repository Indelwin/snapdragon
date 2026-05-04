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

export interface SessionRecordStats {
  nextStoreId: number;
  nextChunkId: number;
  messageCount: number;
}

export function appendRecord(path: string, record: SessionRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`, 'utf8');
}

export function readRecordStats(path: string): SessionRecordStats {
  const stats: SessionRecordStats = { nextStoreId: 1, nextChunkId: 1, messageCount: 0 };
  if (!existsSync(path)) return stats;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    updateStats(stats, line);
  }
  return stats;
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

function updateStats(stats: SessionRecordStats, line: string): void {
  if (line.includes('"type":"message"') || line.includes('"type": "message"')) {
    stats.messageCount += 1;
    stats.nextStoreId = Math.max(stats.nextStoreId, numberField(line, 'store_id') + 1);
  } else if (line.includes('"type":"context_chunk"') || line.includes('"type": "context_chunk"')) {
    stats.nextChunkId = Math.max(stats.nextChunkId, numberField(line, 'chunk_id') + 1);
  }
}

function numberField(line: string, field: string): number {
  const compact = new RegExp(`"${field}":(\\d+)`).exec(line);
  if (compact) return Number(compact[1]);
  const spaced = new RegExp(`"${field}"\\s*:\\s*(\\d+)`).exec(line);
  return spaced ? Number(spaced[1]) : 0;
}
