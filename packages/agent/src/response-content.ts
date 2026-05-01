import type { ThinkingBlock } from '@snapdragon-ai/host';

export function isEmptyContent(content: string): boolean {
  return typeof content !== 'string' || content.trim().length === 0;
}

export function emptyResponseMessage(
  finishReason: string | undefined,
  thinking: ThinkingBlock[] | undefined,
): string {
  const reason = finishReason ?? 'unknown';
  if (thinking && thinking.length > 0) {
    return `provider returned only reasoning, no final content (finish_reason=${reason}); the model thought through the prompt but bailed before producing text — try rephrasing or disabling reasoning`;
  }
  return `provider returned no content (finish_reason=${reason}); the model may have stopped early or hit a content/length limit`;
}
