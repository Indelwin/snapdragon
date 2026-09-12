import type { Message } from '@snapdragon-ai/host';
import { type JsonlSession, type SessionRecord, sessionMetadata } from '@snapdragon-ai/session';

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
  const stats = session.summaryStats();
  return {
    id: session.sessionId,
    title: metadataTitle(stats.metadata) ?? fallbackTitleFromText(stats.firstUserText),
    durationSeconds: Math.max(
      0,
      Math.round((stats.lastMessageAt ?? nowSeconds) - (stats.openedAt ?? nowSeconds)),
    ),
    messages: stats.visibleMessageCount,
    userMessages: stats.userMessageCount,
    toolCalls: stats.toolCallCount,
  };
}

export function sessionTitle(records: SessionRecord[]): string | undefined {
  return metadataTitle(latestSessionMeta(records));
}

function metadataTitle(metadata: Record<string, unknown>): string | undefined {
  const title = metadata.title;
  return typeof title === 'string' && title.trim() ? title.trim() : undefined;
}

export function latestSessionMeta(records: SessionRecord[]): Record<string, unknown> {
  return sessionMetadata(records);
}

export function fallbackTitleFromMessages(messages: Message[]): string | undefined {
  const user = messages.find((message) => message.role === 'user');
  if (!user) return undefined;
  return fallbackTitleFromText(messageText(user));
}

function fallbackTitleFromText(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return trimTitle(text);
}

export function messageText(message: Message): string {
  if (typeof message.content === 'string') return message.content;
  return message.content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join(' ');
}

function trimTitle(text: string): string {
  const words = text.split(/\s+/).slice(0, 8).join(' ');
  return words.length > 72 ? `${words.slice(0, 69)}...` : words;
}
