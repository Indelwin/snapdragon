import { existsSync } from 'node:fs';
import type { Message } from '@snapdragon-ai/host';
import { compactArchiveContext } from './context-archive-compaction.js';
import { applyContextChunk, type ContextFrontierState } from './context-frontier.js';
import { readContextMessages } from './context-message-reader.js';
import type { ContextWindowOptions } from './context-options.js';
import { resolveContextWindowOptions } from './context-options.js';
import { appendContextRecord } from './context-record-append.js';
import { readCompactedContextState, readContextFrontier } from './context-records.js';
import type { ContextChunkInput } from './context-summary.js';
import { assembleContextWindow, type ContextState, recordToMessage } from './context-window.js';
import type { SessionMetadata } from './metadata.js';
import { readSessionMetadata } from './metadata-records.js';
import { readRecentMessageRecords } from './recent-records.js';
import {
  appendRecord,
  readRecordStats,
  readRecords,
  SESSION_SCHEMA_VERSION,
  type SessionContextChunkRecord,
  type SessionMessageRecord,
  type SessionOpenRecord,
  type SessionRecord,
} from './records.js';
import type { ContextCompactionResult } from './session-compaction.js';
import { messageRecords, nextChunkId, nextStoreId } from './session-record-views.js';
import { readSessionSummaryStats, type SessionSummaryStats } from './session-stats.js';

export interface AppendMessageOptions {
  createdAt?: number;
  meta?: Record<string, unknown>;
}

export interface JsonlSessionOptions {
  sessionId: string;
  jsonlPath: string;
}

export type { ContextCompactionResult } from './session-compaction.js';

export class JsonlSession {
  readonly sessionId: string;
  readonly jsonlPath: string;
  #nextStoreId = 1;
  #nextChunkId = 1;
  #messageCount = 0;

  constructor(options: JsonlSessionOptions) {
    this.sessionId = options.sessionId;
    this.jsonlPath = options.jsonlPath;
    const stats = readRecordStats(this.jsonlPath);
    this.#nextStoreId = stats.nextStoreId;
    this.#nextChunkId = stats.nextChunkId;
    this.#messageCount = stats.messageCount;
  }

  appendMessage(message: Message, options: AppendMessageOptions = {}): SessionMessageRecord {
    const record: SessionMessageRecord = {
      type: 'message',
      store_id: this.#nextStoreId,
      role: message.role,
      content: message.content,
      created_at: options.createdAt ?? Date.now() / 1000,
    };
    this.#nextStoreId += 1;
    if (message.tool_call_id) record.tool_call_id = message.tool_call_id;
    if (message.tool_calls) record.tool_calls = message.tool_calls;
    if (message.thinking) record.thinking = message.thinking;
    if (options.meta) record.meta = options.meta;
    this.#appendRecord(record);
    return record;
  }

  appendContextChunk(input: ContextChunkInput): SessionContextChunkRecord {
    return this.#appendContextChunk(input, readContextFrontier(this.jsonlPath));
  }

  #appendContextChunk(
    input: ContextChunkInput,
    frontier: ContextFrontierState,
  ): SessionContextChunkRecord {
    const record: SessionContextChunkRecord = {
      type: 'context_chunk',
      chunk_id: this.#nextChunkId,
      range_start: input.range_start,
      range_end: input.range_end,
      summary_text: input.summary_text,
      source_token_count: input.source_token_count,
      summary_token_count: input.summary_token_count,
      level: input.level,
      kind: input.kind ?? 'leaf',
      depth: input.depth ?? 0,
      created_at: Date.now() / 1000,
      created_by_model: input.created_by_model,
    };
    if (input.meta) record.meta = input.meta;
    if (input.child_chunks) record.child_chunks = input.child_chunks;
    if (!applyContextChunk(frontier, record)) {
      throw new Error('Context chunk does not extend the active append-only frontier.');
    }
    this.#nextChunkId += 1;
    appendContextRecord(this.jsonlPath, record);
    return record;
  }

  appendMeta(meta: Record<string, unknown>): void {
    this.#appendRecord({
      type: 'session_meta',
      updated_at: Date.now() / 1000,
      meta,
    });
  }

  records(): SessionRecord[] {
    return this.#readRecords();
  }

  metadata(): SessionMetadata {
    return readSessionMetadata(this.jsonlPath);
  }

  messageRecords(): SessionMessageRecord[] {
    return this.#readRecords().filter(
      (record): record is SessionMessageRecord => record.type === 'message',
    );
  }

  messages(): Message[] {
    return this.messageRecords().map(recordToMessage);
  }

  recentMessages(limit: number): { messages: Message[]; omitted: number; oversizedLines: number } {
    const bounded = Math.max(0, Math.floor(limit));
    const recent = readRecentMessageRecords(this.jsonlPath, bounded);
    return {
      messages: recent.records.map(recordToMessage),
      omitted: Math.max(0, recent.totalMessages - recent.records.length),
      oversizedLines: recent.oversizedLines,
    };
  }

  messageCount(): number {
    return this.#messageCount;
  }

  summaryStats(): SessionSummaryStats {
    return readSessionSummaryStats(this.jsonlPath);
  }

  contextChunks(): SessionContextChunkRecord[] {
    return this.#readRecords().filter(
      (record): record is SessionContextChunkRecord => record.type === 'context_chunk',
    );
  }

  assembleContext(options: ContextWindowOptions = {}): Message[] {
    return assembleContextWindow(this.#readContextState(options), options).messages;
  }

  compactContext(options: ContextWindowOptions = {}): ContextCompactionResult {
    const frontier = readContextFrontier(this.jsonlPath);
    return compactArchiveContext({
      path: this.jsonlPath,
      frontier,
      options,
      append: (chunk) => this.#appendContextChunk(chunk, frontier),
    });
  }

  assemble(options: { system?: Message | string } = {}): Message[] {
    const system =
      typeof options.system === 'string'
        ? { role: 'system' as const, content: options.system }
        : options.system;
    return system ? [system, ...this.messages()] : this.messages();
  }

  #appendRecord(record: SessionRecord): void {
    appendRecord(this.jsonlPath, record);
    if (record.type === 'message') this.#messageCount += 1;
  }

  #readRecords(): SessionRecord[] {
    const records = readRecords(this.jsonlPath);
    this.#nextStoreId = nextStoreId(records);
    this.#nextChunkId = nextChunkId(records);
    this.#messageCount = messageRecords(records).length;
    return records;
  }

  #readContextState(options: ContextWindowOptions): ContextState {
    if (resolveContextWindowOptions(options).enabled)
      return readCompactedContextState(this.jsonlPath);
    return { messages: readContextMessages(this.jsonlPath, 0), chunks: [] };
  }
}

export function createSessionFile(options: {
  sessionId: string;
  jsonlPath: string;
  meta?: Record<string, unknown>;
}): JsonlSession {
  if (existsSync(options.jsonlPath)) {
    throw new Error(`session already exists at ${options.jsonlPath}`);
  }
  const open: SessionOpenRecord = {
    type: 'session_open',
    session_id: options.sessionId,
    created_at: Date.now() / 1000,
    schema_version: SESSION_SCHEMA_VERSION,
    meta: options.meta,
  };
  appendRecord(options.jsonlPath, open);
  return new JsonlSession(options);
}

export function openSessionFile(options: JsonlSessionOptions): JsonlSession {
  if (!existsSync(options.jsonlPath)) {
    throw new Error(`session does not exist at ${options.jsonlPath}`);
  }
  return new JsonlSession(options);
}
