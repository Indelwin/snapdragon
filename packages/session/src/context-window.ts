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
import type { ContextWindowOptions } from './context-options.js';
import { resolveContextWindowOptions } from './context-options.js';
import { compactionCandidates, selectChunkMessages, sumRecordTokens } from './context-packing.js';
import {
  type ContextChunkInput,
  renderContextChunk,
  summarizeMessagesDeterministically,
} from './context-summary.js';
import type { SessionContextChunkRecord, SessionMessageRecord } from './records.js';
import { estimateMessagesTokens, HeuristicTokenCounter, type TokenCounter } from './tokens.js';

export interface ContextState {
  messages: SessionMessageRecord[];
  chunks: SessionContextChunkRecord[];
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

  const chunks = sortedChunks(state.chunks);
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
  const candidates = compactionCandidates(messages, state.chunks, resolved);
  if (candidates.length === 0) return { reason: 'no_messages' };

  const viewTokens = assembleContextWindow(state, resolved, counter).stats.totalTokens;
  const candidateTokens = sumRecordTokens(candidates, counter);
  const shouldCompact =
    candidateTokens >= resolved.chunkTargetTokens || viewTokens > resolved.maxRequestTokens;
  if (!shouldCompact || candidates.length < resolved.minChunkMessages) {
    return { reason: 'below_target' };
  }

  const selected = selectChunkMessages(candidates, resolved.chunkTargetTokens, counter);
  if (selected.length < resolved.minChunkMessages) return { reason: 'below_target' };

  const sourceTokens = sumRecordTokens(selected, counter);
  const summary = summarizeMessagesDeterministically(
    selected,
    resolved.summaryTargetTokens,
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

function sortedChunks(chunks: SessionContextChunkRecord[]): SessionContextChunkRecord[] {
  return [...chunks].sort((a, b) => a.range_start - b.range_start || a.chunk_id - b.chunk_id);
}

function latestChunkEnd(chunks: SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
