import { existsSync } from 'node:fs';
import type { Message } from '@snapdragon-ai/host';
import type { ContextWindowOptions } from './context-options.js';
import type { ContextChunkInput } from './context-summary.js';
import { assembleContextWindow, recordToMessage } from './context-window.js';
import { type SessionMetadata, sessionMetadata } from './metadata.js';
import {
  appendRecord,
  readRecords,
  SESSION_SCHEMA_VERSION,
  type SessionContextChunkRecord,
  type SessionMessageRecord,
  type SessionOpenRecord,
  type SessionRecord,
} from './records.js';
import { type ContextCompactionResult, compactSessionContext } from './session-compaction.js';

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

  constructor(options: JsonlSessionOptions) {
    this.sessionId = options.sessionId;
    this.jsonlPath = options.jsonlPath;
    const records = readRecords(this.jsonlPath);
    this.#nextStoreId = nextStoreId(records);
    this.#nextChunkId = nextChunkId(records);
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
    appendRecord(this.jsonlPath, record);
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
    appendRecord(this.jsonlPath, record);
    return record;
  }

  appendMeta(meta: Record<string, unknown>): void {
    appendRecord(this.jsonlPath, {
      type: 'session_meta',
      updated_at: Date.now() / 1000,
      meta,
    });
  }

  records(): SessionRecord[] {
    return readRecords(this.jsonlPath);
  }

  metadata(): SessionMetadata {
    return sessionMetadata(this.records());
  }

  messageRecords(): SessionMessageRecord[] {
    return this.records().filter(
      (record): record is SessionMessageRecord => record.type === 'message',
    );
  }

  messages(): Message[] {
    return this.messageRecords().map(recordToMessage);
  }

  messageCount(): number {
    return this.#nextStoreId - 1;
  }

  contextChunks(): SessionContextChunkRecord[] {
    return this.records().filter(
      (record): record is SessionContextChunkRecord => record.type === 'context_chunk',
    );
  }

  assembleContext(options: ContextWindowOptions = {}): Message[] {
    return assembleContextWindow(
      { messages: this.messageRecords(), chunks: this.contextChunks() },
      options,
    ).messages;
  }

  compactContext(options: ContextWindowOptions = {}): ContextCompactionResult {
    return compactSessionContext({
      messages: this.messageRecords(),
      chunks: this.contextChunks(),
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

function nextStoreId(records: SessionRecord[]): number {
  let next = 1;
  for (const record of records) {
    if (record.type === 'message') next = Math.max(next, record.store_id + 1);
  }
  return next;
}

function nextChunkId(records: SessionRecord[]): number {
  let next = 1;
  for (const record of records) {
    if (record.type === 'context_chunk') next = Math.max(next, record.chunk_id + 1);
  }
  return next;
}
