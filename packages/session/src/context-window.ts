/**
 * Public assembly + planning entry points for session context windowing.
 *
 * Compaction-candidate selection lives in `./context-packing.ts` to keep this
 * module focused on the two things callers actually use:
 *   - `assembleContextWindow` — produce the messages array for one provider call
 *   - `planContextCompaction` — decide whether (and what) to compact next
 *
 * Both are pure functions over the session state; the JsonlSession class wires
 * them up to actual JSONL append-only writes.
 */

import type { Message } from '@snapdragon-ai/host';
import { activeContextChunks } from './context-frontier.js';
import { planLeafContextCompaction } from './context-leaf-plan.js';
import type { ContextWindowOptions } from './context-options.js';
import { resolveContextWindowOptions } from './context-options.js';
import { compactionCandidates } from './context-packing.js';
import { selectRollupChunks } from './context-rollup-packing.js';
import {
  type ContextChunkInput,
  renderContextChunk,
  summarizeChunksDeterministically,
} from './context-summary.js';
import type { SessionContextChunkRecord, SessionMessageRecord } from './records.js';
import { estimateMessagesTokens, HeuristicTokenCounter, type TokenCounter } from './tokens.js';

export interface ContextState {
  messages: SessionMessageRecord[];
  chunks: SessionContextChunkRecord[];
  /** Chunks already validated while streaming the append-only archive. */
  activeChunks?: boolean;
}

export interface ContextAssemblyResult {
  messages: Message[];
  stats: {
    chunkCount: number;
    canonicalMessageCount: number;
    visibleCanonicalCount: number;
    totalTokens: number;
    watermark: number;
  };
}

export interface ContextPlanResult {
  chunk?: ContextChunkInput;
  reason?: 'disabled' | 'no_messages' | 'below_target' | 'no_smaller';
}

export function assembleContextWindow(
  state: ContextState,
  options: ContextWindowOptions = {},
  counter: TokenCounter = new HeuristicTokenCounter(),
): ContextAssemblyResult {
  const resolved = resolveContextWindowOptions(options);
  const messages = sortedMessages(state.messages);
  if (!resolved.enabled) return rawAssembly(messages, counter);

  const chunks = state.activeChunks ? state.chunks : activeContextChunks(state.chunks);
  const watermark = latestChunkEnd(chunks);
  const visible = messages.filter((record) => record.store_id > watermark);
  const assembled = [...chunks.map(renderContextChunk), ...visible.map(recordToMessage)];
  return {
    messages: assembled,
    stats: {
      chunkCount: chunks.length,
      canonicalMessageCount: messages.length,
      visibleCanonicalCount: visible.length,
      totalTokens: estimateMessagesTokens(assembled, counter),
      watermark,
    },
  };
}

export function planContextCompaction(
  state: ContextState,
  options: ContextWindowOptions = {},
  counter: TokenCounter = new HeuristicTokenCounter(),
): ContextPlanResult {
  const resolved = resolveContextWindowOptions(options);
  if (!resolved.enabled) return { reason: 'disabled' };

  const messages = sortedMessages(state.messages);
  const chunks = state.activeChunks ? state.chunks : activeContextChunks(state.chunks);
  const candidates = compactionCandidates(messages, chunks, resolved);

  const viewTokens = assembleContextWindow(
    { messages, chunks, activeChunks: true },
    resolved,
    counter,
  ).stats.totalTokens;
  if (candidates.length === 0) {
    return planContextRollup(chunks, resolved, viewTokens, counter);
  }
  const leaf = planLeafContextCompaction(candidates, resolved, viewTokens, counter);
  if (leaf.chunk) return leaf;
  return fallbackRollupUnderPressure(
    chunks,
    resolved,
    viewTokens,
    counter,
    leaf.reason ?? 'below_target',
  );
}

function fallbackRollupUnderPressure(
  chunks: SessionContextChunkRecord[],
  options: ReturnType<typeof resolveContextWindowOptions>,
  viewTokens: number,
  counter: TokenCounter,
  reason: NonNullable<ContextPlanResult['reason']>,
): ContextPlanResult {
  if (viewTokens <= options.maxRequestTokens) return { reason };
  const rollup = planContextRollup(chunks, options, viewTokens, counter);
  return rollup.chunk ? rollup : { reason };
}

function planContextRollup(
  chunks: SessionContextChunkRecord[],
  options: ReturnType<typeof resolveContextWindowOptions>,
  viewTokens: number,
  counter: TokenCounter,
): ContextPlanResult {
  const selected = selectRollupChunks(chunks, options.chunkTargetTokens, counter);
  if (selected.length === 0) return { reason: 'no_messages' };
  const sourceTokens = estimateMessagesTokens(selected.map(renderContextChunk), counter);
  if (sourceTokens < options.chunkTargetTokens && viewTokens <= options.maxRequestTokens) {
    return { reason: 'below_target' };
  }
  const summary = summarizeChunksDeterministically(selected, options.summaryTargetTokens, counter);
  const chunk: ContextChunkInput = {
    range_start: selected[0].range_start,
    range_end: selected[selected.length - 1].range_end,
    summary_text: summary.text,
    source_token_count: sourceTokens,
    summary_token_count: summary.tokens,
    level: 'deterministic',
    kind: 'rollup',
    depth: Math.max(...selected.map((chunk) => chunk.depth ?? 0)) + 1,
    child_chunks: selected.map((chunk) => ({
      chunk_id: chunk.chunk_id,
      range_start: chunk.range_start,
      range_end: chunk.range_end,
    })),
    created_by_model: null,
  };
  return replacementShrinks(chunk, sourceTokens, counter) ? { chunk } : { reason: 'no_smaller' };
}

function replacementShrinks(
  chunk: ContextChunkInput,
  sourceTokens: number,
  counter: TokenCounter,
): boolean {
  return estimateMessagesTokens([renderContextChunk(chunk)], counter) < sourceTokens;
}

export function recordToMessage(record: SessionMessageRecord): Message {
  return {
    role: record.role,
    content: record.content,
    tool_call_id: record.tool_call_id,
    tool_calls: record.tool_calls,
    thinking: record.thinking,
  };
}

function rawAssembly(
  messages: SessionMessageRecord[],
  counter: TokenCounter,
): ContextAssemblyResult {
  const assembled = messages.map(recordToMessage);
  return {
    messages: assembled,
    stats: {
      chunkCount: 0,
      canonicalMessageCount: messages.length,
      visibleCanonicalCount: messages.length,
      totalTokens: estimateMessagesTokens(assembled, counter),
      watermark: 0,
    },
  };
}

function sortedMessages(messages: SessionMessageRecord[]): SessionMessageRecord[] {
  return [...messages].sort((a, b) => a.store_id - b.store_id);
}

function latestChunkEnd(chunks: SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
