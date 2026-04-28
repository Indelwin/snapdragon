import type { Message, MessageContent } from '@snapdragon-ai/host';
import type { SessionMessageRecord } from './records.js';

export interface TokenCounter {
  countString(value: string): number;
  countMessage(message: Pick<Message, 'role' | 'content' | 'tool_call_id' | 'tool_calls'>): number;
}

export const DEFAULT_CHARS_PER_TOKEN = 3.5;
const MESSAGE_FRAMING_TOKENS = 4;

export class HeuristicTokenCounter implements TokenCounter {
  constructor(private readonly charsPerToken = DEFAULT_CHARS_PER_TOKEN) {}

  countString(value: string): number {
    if (value.length === 0) return 0;
    return Math.max(1, Math.ceil(value.length / this.charsPerToken));
  }

  countMessage(message: Pick<Message, 'role' | 'content' | 'tool_call_id' | 'tool_calls'>): number {
    return MESSAGE_FRAMING_TOKENS + this.countString(messageChars(message));
  }
}

export function estimateMessagesTokens(
  messages: Array<Pick<Message, 'role' | 'content' | 'tool_call_id' | 'tool_calls'>>,
  counter: TokenCounter = new HeuristicTokenCounter(),
): number {
  return messages.reduce((total, message) => total + counter.countMessage(message), 0);
}

export function estimateRecordTokens(
  record: SessionMessageRecord,
  counter: TokenCounter = new HeuristicTokenCounter(),
): number {
  return counter.countMessage(record);
}

function messageChars(
  message: Pick<Message, 'role' | 'content' | 'tool_call_id' | 'tool_calls'>,
): string {
  return [
    message.role,
    contentToText(message.content),
    message.tool_call_id ?? '',
    message.tool_calls ? JSON.stringify(message.tool_calls) : '',
  ].join('\n');
}

export function contentToText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => blockToText(block as unknown as Record<string, unknown>))
    .join('\n');
}

function blockToText(block: Record<string, unknown>): string {
  if (typeof block.text === 'string') return block.text;
  if (typeof block.content === 'string') return block.content;
  if (Array.isArray(block.content)) {
    return block.content.map((child) => blockToText(child as Record<string, unknown>)).join('\n');
  }
  return JSON.stringify(block);
}
