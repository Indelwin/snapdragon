import type { Message } from '@snapdragon-ai/host';
import type { JsonlSession, SessionMessageRecord, SessionRecord } from '@snapdragon-ai/session';

export interface SdSessionSummary {
  id: string;
  title?: string;
  durationSeconds: number;
  messages: number;
  userMessages: number;
  toolCalls: number;
}

export function summarizeSession(
  session: JsonlSession,
  nowSeconds = Date.now() / 1000,
): SdSessionSummary {
  const records = session.records();
  const messages = sessionMessages(records);
  return {
    id: session.sessionId,
    title: sessionTitle(records) ?? fallbackTitleFromMessages(messages),
    durationSeconds: sessionDurationSeconds(records, nowSeconds),
    messages: countVisibleMessages(messages),
    userMessages: messages.filter((message) => message.role === 'user').length,
    toolCalls: messages.reduce((total, message) => total + (message.tool_calls?.length ?? 0), 0),
  };
}

export function sessionTitle(records: SessionRecord[]): string | undefined {
  const title = latestSessionMeta(records).title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

export function latestSessionMeta(records: SessionRecord[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const record of records) {
    if (record.type === 'session_open' && record.meta) Object.assign(out, record.meta);
    if (record.type === 'session_meta') Object.assign(out, record.meta);
  }
  return out;
}

export function fallbackTitleFromMessages(messages: Message[]): string | undefined {
  const user = messages.find((message) => message.role === 'user');
  if (!user) return undefined;
  const text = messageText(user).replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return trimTitle(text);
}

export function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ');
}

function sessionMessages(records: SessionRecord[]): Message[] {
  return records.filter(isMessageRecord).map((record) => ({
    role: record.role,
    content: record.content,
    tool_call_id: record.tool_call_id,
    tool_calls: record.tool_calls,
    thinking: record.thinking,
  }));
}

function sessionDurationSeconds(records: SessionRecord[], nowSeconds: number): number {
  const openedAt = records.find((record) => record.type === 'session_open')?.created_at;
  if (!openedAt) return 0;
  const lastMessageAt = [...records]
    .reverse()
    .find((record) => record.type === 'message')?.created_at;
  return Math.max(0, Math.round((lastMessageAt ?? nowSeconds) - openedAt));
}

function countVisibleMessages(messages: Message[]): number {
  return messages.filter((message) => message.role !== 'system').length;
}

function trimTitle(text: string): string {
  const words = text.split(/\s+/).slice(0, 8).join(' ');
  return words.length > 72 ? `${words.slice(0, 69)}...` : words;
}

function isMessageRecord(record: SessionRecord): record is SessionMessageRecord {
  return record.type === 'message';
}
