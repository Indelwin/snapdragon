import { readSync } from 'node:fs';
import {
  consumePreviewChunk,
  createMessagePreviewBatchState,
} from './message-preview-batch-state.js';
import type {
  MessagePreviewBatch,
  ReadMessagePreviewBatchOptions,
} from './message-preview-batch-types.js';
import { messagePreviewBudgetReached, remainingPreviewBytes } from './message-preview-budget.js';

const READ_CHUNK_BYTES = 64 * 1024;

export function readMessagePreviewBatchFile(
  fd: number,
  size: number,
  startOffset: number,
  options: ReadMessagePreviewBatchOptions,
): MessagePreviewBatch {
  const state = createMessagePreviewBatchState(startOffset, options);
  const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
  let position = startOffset;
  while (
    position < size &&
    !messagePreviewBudgetReached(state.startOffset, state.nextOffset, state.scannedRecords, options)
  ) {
    const remaining = remainingPreviewBytes(options.maxBytes, position - startOffset);
    const length = Math.min(buffer.length, size - position, remaining);
    if (length <= 0) break;
    const bytes = readSync(fd, buffer, 0, length, position);
    if (bytes <= 0) break;
    const consumed = consumePreviewChunk(buffer.subarray(0, bytes), position, state, options);
    position += consumed;
    if (consumed < bytes) break;
  }
  return {
    records: state.records,
    nextOffset: state.nextOffset,
    scannedRecords: state.scannedRecords,
    scannedBytes: state.nextOffset - startOffset,
    skipPartialLine: state.partialLine,
    done: state.nextOffset >= size,
  };
}
