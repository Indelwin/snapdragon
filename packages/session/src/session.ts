import { existsSync } from 'node:fs';
import type { Message } from '@snapdragon-ai/host';
import type { ContextWindowOptions } from './context-options.js';
import type { ContextChunkInput } from './context-summary.js';
import { assembleContextWindow, recordToMessage } from './context-window.js';
import { type SessionMetadata, sessionMetadata } from './metadata.js';
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
import { type ContextCompactionResult, compactSessionContext } from './session-compaction.js';
import { contextChunks, messageRecords, nextChunkId, nextStoreId } from './session-record-views.js';

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
  #records: SessionRecord[] | undefined;

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
    const record: SessionContextChunkRecord = {
      type: 'context_chunk',
      chunk_id: this.#nextChunkId,
      range_start: input.range_start,
      range_end: input.range_end,
      summary_text: input.summary_text,
      source_token_count: input.source_token_count,
      summary_token_count: input.summary_token_count,
      level: input.level,
      created_at: Date.now() / 1000,
      created_by_model: input.created_by_model,
    };
    this.#nextChunkId += 1;
    if (input.meta) record.meta = input.meta;
    this.#appendRecord(record);
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
    return this.#loadRecords().slice();
  }

  metadata(): SessionMetadata {
    return sessionMetadata(this.#loadRecords());
  }

  messageRecords(): SessionMessageRecord[] {
    return this.#loadRecords().filter(
      (record): record is SessionMessageRecord => record.type === 'message',
    );
  }

  messages(): Message[] {
    return this.messageRecords().map(recordToMessage);
  }

  messageCount(): number {
    return this.#messageCount;
  }

  contextChunks(): SessionContextChunkRecord[] {
    return this.#loadRecords().filter(
      (record): record is SessionContextChunkRecord => record.type === 'context_chunk',
    );
  }

  assembleContext(options: ContextWindowOptions = {}): Message[] {
    const records = this.#loadRecords();
    return assembleContextWindow(
      { messages: messageRecords(records), chunks: contextChunks(records) },
      options,
    ).messages;
  }

  compactContext(options: ContextWindowOptions = {}): ContextCompactionResult {
    const records = this.#loadRecords();
    return compactSessionContext({
      messages: messageRecords(records),
      chunks: contextChunks(records),
      options,
      append: (chunk) => this.appendContextChunk(chunk),
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
    this.#records?.push(record);
  }

  #loadRecords(): SessionRecord[] {
    this.#records ??= readRecords(this.jsonlPath);
    this.#nextStoreId = nextStoreId(this.#records);
    this.#nextChunkId = nextChunkId(this.#records);
    this.#messageCount = messageRecords(this.#records).length;
    return this.#records;
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
