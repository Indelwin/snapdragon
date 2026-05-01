import type { Message } from '@snapdragon-ai/host';

export interface RequestReplacement {
  visible: Message;
  request: Message;
}

export function decorateMessages(
  systemMessages: Message[],
  messages: Message[],
  replacement?: RequestReplacement,
): Message[] {
  const contextMessages = replacement ? replaceVisibleMessage(messages, replacement) : messages;
  return [...systemMessages, ...contextMessages];
}

function replaceVisibleMessage(messages: Message[], replacement: RequestReplacement): Message[] {
  const index = findEquivalentMessageIndex(messages, replacement.visible);
  if (index < 0) return messages;
  const out = messages.slice();
  out[index] = replacement.request;
  return out;
}

function findEquivalentMessageIndex(messages: Message[], target: Message): number {
  const targetContent = JSON.stringify(target.content);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index];
    if (candidate.role === target.role && JSON.stringify(candidate.content) === targetContent) {
      return index;
    }
  }
  return -1;
}
