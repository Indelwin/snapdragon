import { contentText } from '../content.js';
import type { ContentBlock } from '../types.js';

export function anthropicContentBlock(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'image') return anthropicImageBlock(block);
  if (block.type === 'file') return anthropicDocumentBlock(block);
  return { type: 'text', text: contentText(block.content) };
}

function anthropicImageBlock(
  block: Extract<ContentBlock, { type: 'image' }>,
): Record<string, unknown> {
  return { type: 'image', source: anthropicMediaSource(block.source) };
}

function anthropicDocumentBlock(
  block: Extract<ContentBlock, { type: 'file' }>,
): Record<string, unknown> {
  return { type: 'document', source: anthropicMediaSource(block.source) };
}

type ImageOrFileSource =
  | Extract<ContentBlock, { type: 'image' }>['source']
  | Extract<ContentBlock, { type: 'file' }>['source'];

function anthropicMediaSource(source: ImageOrFileSource): Record<string, unknown> {
  if (source.type === 'url') return { type: 'url', url: source.url };
  if (source.type === 'file') return { type: 'file', file_id: source.file_id };
  return { type: 'base64', media_type: source.media_type, data: source.data };
}
