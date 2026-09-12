import type { ResolvedContextWindowOptions } from './context-options.js';
import { selectChunkMessages, sumRecordTokens } from './context-packing.js';
import type { ContextChunkInput } from './context-summary.js';
import { summarizeMessagesDeterministically } from './context-summary.js';
import type { SessionMessageRecord } from './records.js';
import type { TokenCounter } from './tokens.js';

export interface LeafContextPlan {
  chunk?: ContextChunkInput;
  reason?: 'below_target' | 'no_smaller';
}

export function planLeafContextCompaction(
  candidates: SessionMessageRecord[],
  options: ResolvedContextWindowOptions,
  viewTokens: number,
  counter: TokenCounter,
): LeafContextPlan {
  const candidateTokens = sumRecordTokens(candidates, counter);
  const selected = selectChunkMessages(candidates, options.chunkTargetTokens, counter);
  if (!shouldCompactLeaf(candidateTokens, selected.length, options, viewTokens)) {
    return { reason: 'below_target' };
  }

  const sourceTokens = sumRecordTokens(selected, counter);
  const summary = summarizeMessagesDeterministically(
    selected,
    options.summaryTargetTokens,
    counter,
  );
  if (summary.tokens >= sourceTokens) return { reason: 'no_smaller' };
  return {
    chunk: {
      range_start: selected[0].store_id,
      range_end: selected[selected.length - 1].store_id,
      summary_text: summary.text,
      source_token_count: sourceTokens,
      summary_token_count: summary.tokens,
      level: 'deterministic',
      created_by_model: null,
    },
  };
}

function shouldCompactLeaf(
  candidateTokens: number,
  selectedCount: number,
  options: ResolvedContextWindowOptions,
  viewTokens: number,
): boolean {
  const enoughMessages = selectedCount >= options.minChunkMessages;
  const underPressure = viewTokens > options.maxRequestTokens;
  return enoughMessages && (candidateTokens >= options.chunkTargetTokens || underPressure);
}
