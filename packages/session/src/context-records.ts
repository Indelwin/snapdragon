import {
  applyContextChunk,
  type ContextFrontierState,
  createContextFrontier,
  sortedActiveChunks,
} from './context-frontier.js';
import { readContextMessages } from './context-message-reader.js';
import {
  CONTEXT_RECORD_BYTES,
  CONTEXT_STATE_BYTES,
  CONTEXT_STATE_RECORDS,
  ContextReadBudgetExceededError,
} from './context-read-budget.js';
import type { ContextState } from './context-window.js';
import { hasRecordTypePrefix } from './record-envelope.js';
import { forEachRecordLine } from './record-line-reader.js';
import { parseRecord, type SessionContextChunkRecord } from './records.js';

export function readCompactedContextState(path: string): ContextState {
  const frontier = readContextFrontier(path);
  const active = sortedActiveChunks(frontier);
  return {
    chunks: active,
    activeChunks: true,
    messages: readContextMessages(path, latestChunkEnd(active)),
  };
}

export function readActiveContextChunks(path: string): SessionContextChunkRecord[] {
  return sortedActiveChunks(readContextFrontier(path));
}

export function readContextFrontier(path: string): ContextFrontierState {
  const frontier = createContextFrontier();
  const sizes = new Map<number, number>();
  let bytes = 0;
  forEachRecordLine(
    path,
    (line, truncated) => {
      if (!isContextChunkLine(line)) return;
      if (truncated) throw new ContextReadBudgetExceededError('frontier', CONTEXT_RECORD_BYTES);
      const record = parseRecord(line);
      if (record?.type === 'context_chunk' && applyContextChunk(frontier, record)) {
        for (const child of record.child_chunks ?? []) {
          bytes -= sizes.get(child.chunk_id) ?? 0;
          sizes.delete(child.chunk_id);
        }
        const size = Buffer.byteLength(line);
        sizes.set(record.chunk_id, size);
        bytes += size;
        if (bytes > CONTEXT_STATE_BYTES || sizes.size > CONTEXT_STATE_RECORDS) {
          throw new ContextReadBudgetExceededError('frontier', CONTEXT_STATE_BYTES);
        }
      }
    },
    { maxLineChars: 1_048_576 },
  );
  return frontier;
}

function isContextChunkLine(line: string): boolean {
  return hasRecordTypePrefix(line, 'context_chunk');
}

function latestChunkEnd(chunks: readonly SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
