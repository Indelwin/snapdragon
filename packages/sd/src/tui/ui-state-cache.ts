import type { JsonValue } from '@snapdragon-ai/ui';
import type { ChatEntry } from './ui-entry.js';
import {
  MAX_TRANSCRIPT_ENTRY_CHARS,
  MAX_TRANSCRIPT_THINKING_CHARS,
  MAX_TRANSCRIPT_TOOL_CHARS,
  safeUiText,
} from './ui-text.js';

export function trimChatEntries(entries: readonly ChatEntry[], maxEntries: number): ChatEntry[] {
  return entries.slice(-maxEntries).map(normalizeChatEntry);
}

export function chatEntriesToJson(entries: readonly ChatEntry[]): JsonValue[] {
  return entries.map((entry) => ({ ...entry }));
}

export function appendStreamingText(current: string, delta: string, maxChars: number): string {
  const marker = '\n[stream truncated for TUI display]';
  if (current.endsWith(marker)) return current;
  const next = current + delta;
  if (next.length <= maxChars) return next;
  return `${next.slice(0, Math.max(0, maxChars - marker.length)).trimEnd()}${marker}`;
}

function normalizeChatEntry(entry: ChatEntry): ChatEntry {
  const contentLimit =
    entry.role === 'tool' ? MAX_TRANSCRIPT_TOOL_CHARS : MAX_TRANSCRIPT_ENTRY_CHARS;
  return {
    ...entry,
    content: safeUiText(entry.content, contentLimit),
    thinking: entry.thinking
      ? safeUiText(entry.thinking, MAX_TRANSCRIPT_THINKING_CHARS)
      : undefined,
  };
}
