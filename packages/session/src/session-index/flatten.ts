import type { MessageContent } from '@snapdragon-ai/host';
import { flattenBlocks } from './flatten-block.js';
import { capIndexText, MAX_INDEX_CONTENT_CHARS } from './index-text.js';

export {
  capIndexText,
  MAX_INDEX_CONTENT_CHARS,
  MAX_INDEX_METADATA_CHARS,
} from './index-text.js';

/**
 * Collapse a `MessageContent` into searchable plain text. Non-text blocks
 * (image/file) are reduced to a stable placeholder so they don't pollute the
 * FTS index but are still discoverable. Tool-result blocks are recursed.
 */
export function flattenMessageContent(content: MessageContent | null | undefined): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return capIndexText(content);
  return flattenBlocks(content, MAX_INDEX_CONTENT_CHARS);
}
