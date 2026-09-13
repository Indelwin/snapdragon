import type { ResolvedContextWindowOptions } from './context-options.js';
import { selectChunkMessages, sumRecordTokens } from './context-packing.js';
import { CONTEXT_BATCH_BYTES, ContextReadBudgetExceededError } from './context-read-budget.js';
import { type ContextChunkInput, summarizeMessagesDeterministically } from './context-summary.js';
import type { SessionMessageRecord } from './records.js';
import { HeuristicTokenCounter } from './tokens.js';

export interface ContextMessageBatch {
  messages: SessionMessageRecord[];
  sizes: number[];
  bytes: number;
}

export function compactContextBatch(
  batch: ContextMessageBatch,
  options: ResolvedContextWindowOptions,
  append: (chunk: ContextChunkInput) => unknown,
): void {
  const candidates = batch.messages.slice(0, -options.freshTailCount);
  const counter = new HeuristicTokenCounter();
  const selected = selectChunkMessages(
    candidates,
    options.chunkTargetTokens,
    counter,
    options.minChunkMessages,
  );
  const sourceTokens = sumRecordTokens(selected, counter);
  const summary = summarizeMessagesDeterministically(
    selected,
    options.summaryTargetTokens,
    counter,
  );
  if (selected.length < options.minChunkMessages || summary.tokens >= sourceTokens) {
    throw new ContextReadBudgetExceededError(
      'messages',
      CONTEXT_BATCH_BYTES,
      candidates[0]?.store_id,
    );
  }
  append({
    range_start: selected[0].store_id,
    range_end: selected[selected.length - 1].store_id,
    summary_text: summary.text,
    source_token_count: sourceTokens,
    summary_token_count: summary.tokens,
    level: 'deterministic',
    kind: 'leaf',
  });
  batch.messages.splice(0, selected.length);
  batch.bytes -= batch.sizes.splice(0, selected.length).reduce((total, size) => total + size, 0);
}
