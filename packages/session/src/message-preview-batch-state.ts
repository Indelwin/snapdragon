import type { ReadMessagePreviewBatchOptions } from './message-preview-batch-types.js';
import { messagePreviewBudgetReached } from './message-preview-budget.js';
import { retainPreviewLineBytes, takePreviewLine } from './message-preview-line.js';
import { parseMessagePreview } from './message-preview-parse.js';
import {
  DEFAULT_MAX_PARSE_LINE_CHARS,
  type SessionMessagePreview,
} from './message-preview-types.js';

export interface MessagePreviewBatchState {
  records: SessionMessagePreview[];
  roles?: Set<string>;
  startOffset: number;
  nextOffset: number;
  scannedRecords: number;
  linePrefix: Buffer[];
  retainedBytes: number;
  retainLimit: number;
  partialLine: boolean;
  discardLine: boolean;
}

export function createMessagePreviewBatchState(
  startOffset: number,
  options: ReadMessagePreviewBatchOptions,
): MessagePreviewBatchState {
  return {
    records: [],
    roles: options.roles ? new Set(options.roles) : undefined,
    startOffset,
    nextOffset: startOffset,
    scannedRecords: 0,
    linePrefix: [],
    retainedBytes: 0,
    retainLimit: Math.max(1, options.maxParseLineChars ?? DEFAULT_MAX_PARSE_LINE_CHARS),
    partialLine: options.skipPartialLine ?? false,
    discardLine: options.skipPartialLine ?? false,
  };
}

export function consumePreviewChunk(
  chunk: Buffer,
  chunkOffset: number,
  state: MessagePreviewBatchState,
  options: ReadMessagePreviewBatchOptions,
): number {
  let start = 0;
  while (start < chunk.length) {
    const newline = chunk.indexOf(10, start);
    if (newline < 0) {
      if (!state.discardLine) retainPreviewLineBytes(state, chunk.subarray(start));
      state.partialLine = true;
      state.nextOffset = chunkOffset + chunk.length;
      return chunk.length;
    }
    if (!state.discardLine) retainPreviewLineBytes(state, chunk.subarray(start, newline));
    state.nextOffset = chunkOffset + newline + 1;
    visitPreviewLine(state, options);
    state.partialLine = false;
    state.discardLine = false;
    start = newline + 1;
    if (
      messagePreviewBudgetReached(
        state.startOffset,
        state.nextOffset,
        state.scannedRecords,
        options,
      )
    )
      return start;
  }
  return chunk.length;
}

function visitPreviewLine(
  state: MessagePreviewBatchState,
  options: ReadMessagePreviewBatchOptions,
): void {
  state.scannedRecords += 1;
  const line = takePreviewLine(state);
  if (!line) return;
  const preview = parseMessagePreview(line, options);
  if (!preview || (state.roles && !state.roles.has(preview.role))) return;
  if (options.afterCreatedAt !== undefined && preview.created_at <= options.afterCreatedAt) return;
  state.records.push(preview);
}
