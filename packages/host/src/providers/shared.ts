import { contentText, dataUrl, normalizeContent } from '../content.js';
import type {
  ContentBlock,
  LlmChatRequest,
  Message,
  MessageContent,
  ProviderDescriptor,
  ToolChoice,
} from '../types.js';

export type FetchLike = typeof fetch;

export const commonStreamingTools = {
  streaming: true,
  tools: true,
  imageInput: true,
  fileInput: false,
  reasoning: true,
  modelDiscovery: true,
} satisfies ProviderDescriptor['capabilities'];

export function fetchImpl(candidate: FetchLike | undefined): FetchLike {
  return candidate ?? fetch;
}

export function toolChoiceForOpenAI(choice: ToolChoice | undefined): unknown {
  if (choice === undefined) return 'auto';
  if (choice === 'any') return 'required';
  if (choice === 'none') return 'none';
  if (typeof choice === 'string') return choice;
  return { type: 'function', function: { name: choice.name } };
}

export function toolChoiceForResponses(choice: ToolChoice | undefined): unknown {
  if (choice === undefined) return 'auto';
  if (choice === 'any') return 'required';
  if (choice === 'none') return 'none';
  if (typeof choice === 'string') return choice;
  return { type: 'function', name: choice.name };
}

export function textFromMessage(message: Message): string {
  return contentText(message.content);
}

export function sourceToUrl(block: Extract<ContentBlock, { type: 'image' }>): string {
  if (block.source.type === 'url') return block.source.url;
  if (block.source.type === 'base64') {
    return dataUrl(block.source.media_type, block.source.data);
  }
  throw new Error('image file_id is not supported by this provider');
}

export function openAIChatContent(
  content: MessageContent,
): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;
  return normalizeContent(content).map((block) => openAIChatPart(block));
}

function openAIChatPart(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'image') {
    const image_url: Record<string, unknown> = { url: sourceToUrl(block) };
    if (block.detail) image_url.detail = block.detail;
    return { type: 'image_url', image_url };
  }
  if (block.type === 'file') return openAIFilePart(block);
  return { type: 'text', text: contentText(block.content) };
}

function openAIFilePart(block: Extract<ContentBlock, { type: 'file' }>): Record<string, unknown> {
  if (block.source.type === 'file') {
    return { type: 'file', file: { file_id: block.source.file_id, filename: block.filename } };
  }
  if (block.source.type === 'url') {
    return { type: 'file', file: { file_url: block.source.url, filename: block.filename } };
  }
  return {
    type: 'file',
    file: {
      file_data: block.source.data,
      filename: block.filename,
    },
  };
}

export function systemInstructions(messages: Message[]): string | undefined {
  const text = messages
    .filter((message) => message.role === 'system')
    .map(textFromMessage)
    .filter(Boolean)
    .join('\n\n');
  return text.length > 0 ? text : undefined;
}

export function nonSystemMessages(request: LlmChatRequest): Message[] {
  return request.messages.filter((message) => message.role !== 'system');
}
