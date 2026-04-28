import type { Message } from '@snapdragon-ai/host';
import type { SessionContextChunkRecord, SessionMessageRecord } from './records.js';
import { contentToText, HeuristicTokenCounter, type TokenCounter } from './tokens.js';

export interface ContextChunkInput {
  range_start: number;
  range_end: number;
  summary_text: string;
  source_token_count: number;
  summary_token_count: number;
  level: 'deterministic' | 'summary';
  created_by_model?: string | null;
  meta?: Record<string, unknown>;
}

export function renderContextChunk(record: SessionContextChunkRecord): Message {
  return {
    role: 'user',
    content: [
      `Context summary for earlier canonical messages ${record.range_start}-${record.range_end}.`,
      'The original messages remain in the session JSONL and can be expanded by tools later.',
      '',
      record.summary_text,
    ].join('\n'),
  };
}

export function summarizeMessagesDeterministically(
  records: SessionMessageRecord[],
  targetTokens: number,
  counter: TokenCounter = new HeuristicTokenCounter(),
): { text: string; tokens: number } {
  const header = `Deterministic compacted summary of ${records.length} canonical message(s).`;
  const body = records.map((record) => summarizeRecord(record)).join('\n');
  const targetChars = Math.max(160, Math.floor(targetTokens * 3.5));
  const text = truncateToChars(`${header}\n${body}`, targetChars);
  return { text, tokens: counter.countString(text) };
}

function summarizeRecord(record: SessionMessageRecord): string {
  const callNames = record.tool_calls?.map((call) => call.name).join(', ');
  const prefix = [`#${record.store_id}`, record.role].join(' ');
  const suffix = callNames ? ` tool_calls=${callNames}` : '';
  return `${prefix}${suffix}: ${preview(contentToText(record.content), previewLimit(record))}`;
}

function previewLimit(record: SessionMessageRecord): number {
  return record.role === 'tool' ? 420 : 720;
}

function preview(value: string, maxChars: number): string {
  const flattened = value.replace(/\s+/g, ' ').trim();
  return truncateToChars(flattened, maxChars);
}

function truncateToChars(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 15)).trimEnd()} [truncated]`;
}
