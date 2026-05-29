import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Message } from '@snapdragon-ai/host';
import { forEachRecordLine } from './record-line-reader.js';

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
  forEachRecordLine(path, (line) => updateStats(stats, line));
  return stats;
}

export function readRecords(path: string): SessionRecord[] {
  const out: SessionRecord[] = [];
  forEachRecordLine(path, (line) => {
    const record = parseRecord(line);
    if (record) out.push(record);
  });
  return out;
}

export function parseRecord(line: string): SessionRecord | undefined {
  try {
    return JSON.parse(line) as SessionRecord;
  } catch {
    return undefined;
  }
}

function updateStats(stats: SessionRecordStats, line: string): void {
  if (isMessageLine(line)) {
    stats.messageCount += 1;
    stats.nextStoreId = Math.max(stats.nextStoreId, numberField(line, 'store_id') + 1);
  } else if (line.includes('"type":"context_chunk"') || line.includes('"type": "context_chunk"')) {
    stats.nextChunkId = Math.max(stats.nextChunkId, numberField(line, 'chunk_id') + 1);
  }
}

export function isMessageLine(line: string): boolean {
  return line.includes('"type":"message"') || line.includes('"type": "message"');
}

export function numberField(line: string, field: string): number {
  const compact = new RegExp(`"${field}":(\\d+)`).exec(line);
  if (compact) return Number(compact[1]);
  const spaced = new RegExp(`"${field}"\\s*:\\s*(\\d+)`).exec(line);
  return spaced ? Number(spaced[1]) : 0;
}
