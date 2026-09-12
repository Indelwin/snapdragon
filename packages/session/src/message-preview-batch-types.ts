import type { ReadMessagePreviewsOptions, SessionMessagePreview } from './message-preview-types.js';

export interface ReadMessagePreviewBatchOptions extends ReadMessagePreviewsOptions {
  startOffset?: number;
  skipPartialLine?: boolean;
  maxRecords?: number;
  maxBytes?: number;
}

export interface MessagePreviewBatch {
  records: SessionMessagePreview[];
  nextOffset: number;
  scannedRecords: number;
  scannedBytes: number;
  skipPartialLine: boolean;
  done: boolean;
}
