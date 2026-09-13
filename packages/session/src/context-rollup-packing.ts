import { renderContextChunk } from './context-summary.js';
import type { SessionContextChunkRecord } from './records.js';
import { estimateMessagesTokens, type TokenCounter } from './tokens.js';

export function selectRollupChunks(
  chunks: SessionContextChunkRecord[],
  targetTokens: number,
  counter: TokenCounter,
): SessionContextChunkRecord[] {
  const selected: SessionContextChunkRecord[] = [];
  const minimumSelection = Math.min(2, chunks.length);
  let used = 0;
  for (const chunk of chunks) {
    const cost = estimateMessagesTokens([renderContextChunk(chunk)], counter);
    if (selected.length >= minimumSelection && used + cost > targetTokens) break;
    selected.push(chunk);
    used += cost;
  }
  return selected;
}
