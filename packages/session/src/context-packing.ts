/**
 * Compaction-candidate selection helpers used by `context-window.ts`.
 *
 * Split out from the main module so the public assembly/planning surface stays
 * narrow and so the per-file complexity stays well under the project's CRAP
 * limit. Nothing in here is exported beyond the package — these are
 * implementation details of the compactor.
 */

import type { ResolvedContextWindowOptions } from './context-options.js';
import type { SessionContextChunkRecord, SessionMessageRecord } from './records.js';
import { estimateRecordTokens, type TokenCounter } from './tokens.js';

export function compactionCandidates(
  messages: SessionMessageRecord[],
  chunks: SessionContextChunkRecord[],
  options: ResolvedContextWindowOptions,
): SessionMessageRecord[] {
  const watermark = latestChunkEnd(chunks);
  const tailStart = tailStartStoreId(messages, options.freshTailCount);
  return messages.filter((record) => record.store_id > watermark && record.store_id < tailStart);
}

export function selectChunkMessages(
  candidates: SessionMessageRecord[],
  targetTokens: number,
  counter: TokenCounter,
): SessionMessageRecord[] {
  const selected = packUntilTarget(candidates, targetTokens, counter);
  return extendThroughTrailingToolResults(selected, candidates);
}

export function sumRecordTokens(records: SessionMessageRecord[], counter: TokenCounter): number {
  return records.reduce((total, record) => total + estimateRecordTokens(record, counter), 0);
}

function packUntilTarget(
  candidates: SessionMessageRecord[],
  targetTokens: number,
  counter: TokenCounter,
): SessionMessageRecord[] {
  const selected: SessionMessageRecord[] = [];
  let used = 0;
  for (const candidate of candidates) {
    const cost = estimateRecordTokens(candidate, counter);
    if (selected.length > 0 && used + cost > targetTokens) break;
    selected.push(candidate);
    used += cost;
  }
  return selected;
}

/**
 * If the selection ends mid-tool-call (assistant with tool_calls but missing
 * some tool results), extend forward to grab the matching tool results. If we
 * can't satisfy the call, drop the trailing assistant rather than leaving a
 * dangling tool_call in the summary.
 */
function extendThroughTrailingToolResults(
  selected: SessionMessageRecord[],
  candidates: SessionMessageRecord[],
): SessionMessageRecord[] {
  const assistantIndex = trailingAssistantWithToolsIndex(selected);
  if (assistantIndex < 0) return selected;
  const extended = appendFollowingToolResults(selected, candidates);
  return hasToolResultsForAssistant(extended, assistantIndex)
    ? extended
    : extended.slice(0, assistantIndex);
}

function appendFollowingToolResults(
  selected: SessionMessageRecord[],
  candidates: SessionMessageRecord[],
): SessionMessageRecord[] {
  const last = selected.at(-1);
  if (!last) return selected;
  const lastIndex = candidates.findIndex((record) => record.store_id === last.store_id);
  if (lastIndex < 0) return selected;
  const out = selected.slice();
  for (let index = lastIndex + 1; index < candidates.length; index += 1) {
    const next = candidates[index];
    if (!isToolResult(next)) break;
    out.push(next);
  }
  return out;
}

function trailingAssistantWithToolsIndex(selected: SessionMessageRecord[]): number {
  for (let index = selected.length - 1; index >= 0; index -= 1) {
    if (isAssistantWithToolCalls(selected[index])) return index;
    if (!isToolResult(selected[index])) return -1;
  }
  return -1;
}

function isAssistantWithToolCalls(record: SessionMessageRecord): boolean {
  return record.role === 'assistant' && hasToolCalls(record);
}

function hasToolCalls(record: SessionMessageRecord): boolean {
  const calls = record.tool_calls;
  return calls !== undefined && calls.length > 0;
}

function hasToolResultsForAssistant(
  selected: SessionMessageRecord[],
  assistantIndex: number,
): boolean {
  const expected = collectToolCallIds(selected[assistantIndex]);
  if (expected.size === 0) return true;
  for (const record of selected.slice(assistantIndex + 1)) {
    if (record.tool_call_id) expected.delete(record.tool_call_id);
  }
  return expected.size === 0;
}

function collectToolCallIds(record: SessionMessageRecord): Set<string> {
  const calls = record.tool_calls;
  if (!calls) return new Set();
  return new Set(calls.map((call) => call.id));
}

function isToolResult(record: SessionMessageRecord): boolean {
  return record.role === 'tool' || record.tool_call_id !== undefined;
}

function tailStartStoreId(messages: SessionMessageRecord[], freshTailCount: number): number {
  if (messages.length <= freshTailCount) return Number.POSITIVE_INFINITY;
  return messages[messages.length - freshTailCount].store_id;
}

function latestChunkEnd(chunks: SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
