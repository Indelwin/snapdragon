import type { Message } from '@snapdragon-ai/host';
import {
  MAX_TRANSCRIPT_ENTRY_CHARS,
  MAX_TRANSCRIPT_THINKING_CHARS,
  MAX_TRANSCRIPT_TOOL_CHARS,
  safeUiText,
} from './ui-text.js';

export function thinkingText(blocks: Message['thinking']): string | undefined {
  const text = blocks
    ?.map((block) => block.text)
    .filter((line) => typeof line === 'string' && line.length > 0)
    .join('\n');
  return text ? safeUiText(text, MAX_TRANSCRIPT_THINKING_CHARS) : undefined;
}

export function messageContentSummary(message: Message): string {
  if (typeof message.content !== 'string') {
    const blocks = message.content.map((block) => block.type).join(', ');
    return `[${blocks || 'content'}]`;
  }
  const maxChars = message.role === 'tool' ? MAX_TRANSCRIPT_TOOL_CHARS : MAX_TRANSCRIPT_ENTRY_CHARS;
  return safeUiText(message.content, maxChars);
}
