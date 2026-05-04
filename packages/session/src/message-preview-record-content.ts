import type { SessionMessageRecord } from './records.js';

export function contentText(content: SessionMessageRecord['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block): block is { type: 'text'; text: string } => block?.type === 'text')
    .map((block) => block.text)
    .join(' ')
    .trim();
}
