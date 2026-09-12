import { type ContextMessageBatch, compactContextBatch } from './context-batch-compaction.js';
import { type ContextFrontierState, sortedActiveChunks } from './context-frontier.js';
import { forEachContextMessage } from './context-message-reader.js';
import { type ContextWindowOptions, resolveContextWindowOptions } from './context-options.js';
import { CONTEXT_BATCH_BYTES, CONTEXT_STATE_RECORDS } from './context-read-budget.js';
import type { ContextChunkInput } from './context-summary.js';
import type { SessionContextChunkRecord } from './records.js';
import { type ContextCompactionResult, compactSessionContext } from './session-compaction.js';

export function compactArchiveContext(args: {
  path: string;
  options: ContextWindowOptions;
  frontier: ContextFrontierState;
  append: (chunk: ContextChunkInput) => SessionContextChunkRecord;
}): ContextCompactionResult {
  const options = resolveContextWindowOptions(args.options);
  if (!options.enabled) return { compacted: false, chunks: [], reason: 'disabled' };
  const firstChunkId = args.frontier.maxChunkId + 1;
  const watermark = sortedActiveChunks(args.frontier).at(-1)?.range_end ?? 0;
  const batch: ContextMessageBatch = { messages: [], sizes: [], bytes: 0 };
  const compact = (messages = batch.messages) =>
    compactSessionContext({
      messages,
      chunks: sortedActiveChunks(args.frontier),
      activeChunks: true,
      options,
      append: args.append,
    });
  forEachContextMessage(args.path, watermark, (record, bytes) => {
    batch.messages.push(record);
    batch.sizes.push(bytes);
    batch.bytes += bytes;
    while (batch.bytes > CONTEXT_BATCH_BYTES || batch.messages.length > CONTEXT_STATE_RECORDS / 2) {
      compactContextBatch(batch, options, args.append);
      compact([]);
    }
  });
  const result = compact();
  const chunks = sortedActiveChunks(args.frontier).filter(
    (chunk) => chunk.chunk_id >= firstChunkId,
  );
  return { ...result, compacted: chunks.length > 0, chunks };
}
