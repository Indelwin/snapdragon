import type { Message } from '@snapdragon-ai/host';
import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdRuntime } from '../runtime.js';
import { messageContentSummary, thinkingText } from './transcript-entry-content.js';
import type { ChatEntry } from './ui-entry.js';

export function runtimeTranscriptEntries(
  messages: readonly Message[],
  maxEntries: number,
): ChatEntry[] {
  const omitted = Math.max(0, messages.length - maxEntries);
  const visibleLimit = omitted > 0 ? Math.max(1, maxEntries - 1) : maxEntries;
  const entries = messages.slice(-visibleLimit).map(messageToEntry);
  if (omitted > 0) entries.unshift(omittedTranscriptEntry(omitted));
  return entries;
}

export function initialTranscriptEntries(runtime: SdRuntime, maxEntries: number): ChatEntry[] {
  return runtime.agent.messages.length > 0
    ? runtimeTranscriptEntries(runtime.agent.messages, maxEntries)
    : sessionTranscriptEntries(runtime.session, maxEntries);
}

export function sessionTranscriptEntries(
  session: JsonlSession | undefined,
  maxEntries: number,
): ChatEntry[] {
  if (!session) return [];
  const recent = session.recentMessages(maxEntries);
  const omittedFromRecent = Math.max(0, recent.omitted);
  const visibleLimit = omittedFromRecent > 0 ? Math.max(1, maxEntries - 1) : maxEntries;
  const visible = recent.messages.slice(-visibleLimit);
  const entries = visible.map(messageToEntry);
  const omitted = omittedFromRecent + Math.max(0, recent.messages.length - visible.length);
  if (omitted > 0) entries.unshift(omittedTranscriptEntry(omitted));
  return entries;
}

export function sessionMessageCount(runtime: SdRuntime): number {
  return runtime.session?.messageCount() ?? runtime.session?.messages().length ?? 0;
}

export function messageToEntry(message: Message): ChatEntry {
  return {
    id: `${message.role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    role: message.role,
    content: messageContentSummary(message),
    toolCalls: message.tool_calls?.length ?? 0,
    thinking: thinkingText(message.thinking),
  };
}

function omittedTranscriptEntry(count: number): ChatEntry {
  return {
    id: `history_omitted_${count}`,
    role: 'system',
    content: `${count} earlier message(s) hidden from the live transcript; session context remains available through compaction and tools.`,
  };
}
