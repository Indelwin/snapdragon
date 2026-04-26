import { contentText, normalizeContent } from '../content.js';
import type { ContentBlock, Message } from '../types.js';

export function convertMessageToAnthropic(message: Message): Record<string, unknown> | null {
  if (message.role === 'system') return null;
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: contentText(message.content),
        },
      ],
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return assistantToolUseMessage(message);
  }
  return {
    role: message.role,
    content: normalizeContent(message.content).map(anthropicContentBlock),
  };
}

export function anthropicSystem(messages: Message[]): string | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .map((message) => contentText(message.content))
    .filter(Boolean)
    .join('\n\n');
  return text.length > 0 ? text : undefined;
}

function assistantToolUseMessage(message: Message): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  for (const block of message.thinking ?? []) {
    content.push({ type: 'thinking', thinking: block.text, signature: block.signature });
  }
  content.push(...normalizeContent(message.content).map(anthropicContentBlock));
  for (const call of message.tool_calls ?? []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.name,
      input: safeJson<Record<string, unknown>>(call.args_json) ?? {},
    });
  }
  return { role: 'assistant', content };
}

function anthropicContentBlock(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'image') return anthropicImageBlock(block);
  if (block.type === 'file') return anthropicDocumentBlock(block);
  return { type: 'text', text: contentText(block.content) };
}

function anthropicImageBlock(
  block: Extract<ContentBlock, { type: 'image' }>,
): Record<string, unknown> {
  if (block.source.type === 'url') {
    return { type: 'image', source: { type: 'url', url: block.source.url } };
  }
  if (block.source.type === 'file') {
    return { type: 'image', source: { type: 'file', file_id: block.source.file_id } };
  }
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: block.source.media_type,
      data: block.source.data,
    },
  };
}

function anthropicDocumentBlock(
  block: Extract<ContentBlock, { type: 'file' }>,
): Record<string, unknown> {
  if (block.source.type === 'url') {
    return { type: 'document', source: { type: 'url', url: block.source.url } };
  }
  if (block.source.type === 'file') {
    return { type: 'document', source: { type: 'file', file_id: block.source.file_id } };
  }
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: block.source.media_type,
      data: block.source.data,
    },
  };
}

function safeJson<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}
