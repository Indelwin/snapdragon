import type { ContentBlock } from '@snapdragon-ai/host';
import { appendIndexPart, capIndexText } from './index-text.js';

export function flattenBlocks(blocks: readonly ContentBlock[], maxChars: number): string {
  let out = '';
  for (const block of blocks) {
    const remaining = maxChars - out.length - (out.length > 0 ? 1 : 0);
    if (remaining <= 0) break;
    out = appendIndexPart(out, flattenBlock(block, remaining));
  }
  return out;
}

function flattenBlock(block: ContentBlock, maxChars: number): string {
  switch (block.type) {
    case 'text':
      return capIndexText(block.text, maxChars);
    case 'image':
      return '';
    case 'file':
      return capIndexText(block.filename ?? '', maxChars);
    case 'tool_result':
      return flattenToolResult(block.content, maxChars);
    default:
      return '';
  }
}

function flattenToolResult(content: ContentBlock[] | string, maxChars: number): string {
  return typeof content === 'string'
    ? capIndexText(content, maxChars)
    : flattenBlocks(content, maxChars);
}
