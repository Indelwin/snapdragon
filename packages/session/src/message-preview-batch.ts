import { closeSync, existsSync, openSync, statSync } from 'node:fs';
import { readMessagePreviewBatchFile } from './message-preview-batch-reader.js';
import type {
  MessagePreviewBatch,
  ReadMessagePreviewBatchOptions,
} from './message-preview-batch-types.js';

export type {
  MessagePreviewBatch,
  ReadMessagePreviewBatchOptions,
} from './message-preview-batch-types.js';

export function readMessagePreviewBatch(
  path: string,
  options: ReadMessagePreviewBatchOptions = {},
): MessagePreviewBatch {
  if (!existsSync(path)) return emptyBatch();
  const size = statSync(path).size;
  const startOffset = validStartOffset(options.startOffset, size);
  const fd = openSync(path, 'r');
  try {
    return readMessagePreviewBatchFile(fd, size, startOffset, options);
  } finally {
    closeSync(fd);
  }
}

function validStartOffset(value: number | undefined, size: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > size) return 0;
  return Math.floor(value);
}

function emptyBatch(): MessagePreviewBatch {
  return {
    records: [],
    nextOffset: 0,
    scannedRecords: 0,
    scannedBytes: 0,
    skipPartialLine: false,
    done: true,
  };
}
