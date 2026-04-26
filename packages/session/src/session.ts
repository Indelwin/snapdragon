import { existsSync } from 'node:fs';
import type { Message } from '@snapdragon-ai/host';
import {
  appendRecord,
  readRecords,
  SESSION_SCHEMA_VERSION,
  type SessionMessageRecord,
  type SessionOpenRecord,
  type SessionRecord,
} from './records.js';

export interface AppendMessageOptions {
  createdAt?: number;
  meta?: Record<string, unknown>;
}

export interface JsonlSessionOptions {
  sessionId: string;
  jsonlPath: string;
}

export class JsonlSession {
  readonly sessionId: string;
  readonly jsonlPath: string;
  #nextStoreId = 1;

  constructor(options: JsonlSessionOptions) {
    this.sessionId = options.sessionId;
    this.jsonlPath = options.jsonlPath;
    this.#nextStoreId = nextStoreId(readRecords(this.jsonlPath));
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

  messages(): Message[] {
    return this.records()
      .filter((record): record is SessionMessageRecord => record.type === 'message')
      .map(recordToMessage);
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

function recordToMessage(record: SessionMessageRecord): Message {
  return {
    role: record.role,
    content: record.content,
    tool_call_id: record.tool_call_id,
    tool_calls: record.tool_calls,
    thinking: record.thinking,
  };
}
