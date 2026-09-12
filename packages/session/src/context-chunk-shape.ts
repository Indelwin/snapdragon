import {
  nonNegativeNumber,
  positiveInteger,
  validContextDepth,
  validContextKind,
  validContextRange,
} from './context-chunk-values.js';
import type { SessionContextChunkRecord, SessionContextChunkReference } from './records.js';

export function validContextChunkShape(chunk: SessionContextChunkRecord): boolean {
  return (
    chunk.type === 'context_chunk' &&
    positiveInteger(chunk.chunk_id) &&
    validContextRange(chunk.range_start, chunk.range_end) &&
    typeof chunk.summary_text === 'string' &&
    nonNegativeNumber(chunk.source_token_count) &&
    nonNegativeNumber(chunk.summary_token_count) &&
    nonNegativeNumber(chunk.created_at) &&
    validContextKind(chunk.kind) &&
    validContextDepth(chunk.depth) &&
    (chunk.child_chunks === undefined || chunk.child_chunks.every(validChunkReference))
  );
}

export function validChunkReference(reference: SessionContextChunkReference): boolean {
  return (
    positiveInteger(reference.chunk_id) &&
    validContextRange(reference.range_start, reference.range_end)
  );
}
