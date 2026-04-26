import type {
  ContentBlock,
  FileContentBlock,
  ImageContentBlock,
  Message,
  MessageContent,
  TextContentBlock,
} from './types.js';

export function textBlock(text: string): TextContentBlock {
  return { type: 'text', text };
}

export function normalizeContent(content: MessageContent | null | undefined): ContentBlock[] {
  if (content === null || content === undefined) return [];
  if (typeof content === 'string') return content.length > 0 ? [textBlock(content)] : [];
  return content;
}

export function contentText(content: MessageContent | null | undefined): string {
  return normalizeContent(content)
    .filter((block): block is TextContentBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export function messageText(message: Pick<Message, 'content'>): string {
  return contentText(message.content);
}

export function hasImageContent(content: MessageContent | null | undefined): boolean {
  return normalizeContent(content).some((block) => block.type === 'image');
}

export function hasFileContent(content: MessageContent | null | undefined): boolean {
  return normalizeContent(content).some((block) => block.type === 'file');
}

export function imageBlocks(content: MessageContent | null | undefined): ImageContentBlock[] {
  return normalizeContent(content).filter(
    (block): block is ImageContentBlock => block.type === 'image',
  );
}

export function fileBlocks(content: MessageContent | null | undefined): FileContentBlock[] {
  return normalizeContent(content).filter(
    (block): block is FileContentBlock => block.type === 'file',
  );
}

export function dataUrl(mediaType: string, base64Data: string): string {
  return `data:${mediaType};base64,${base64Data}`;
}

export function normalizeMessage(message: Message): Message {
  return {
    ...message,
    content: normalizeContent(message.content),
  };
}
