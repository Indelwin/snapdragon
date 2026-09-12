import {
  applyContextChunk,
  type ContextFrontierState,
  createContextFrontier,
  sortedActiveChunks,
} from './context-frontier.js';
import type { ContextState } from './context-window.js';
import { hasRecordTypePrefix, recordIdFromPrefix } from './record-envelope.js';
import { forEachRecordLine } from './record-line-reader.js';
import {
  isMessageLine,
  parseRecord,
  type SessionContextChunkRecord,
  type SessionMessageRecord,
} from './records.js';

export function readCompactedContextState(path: string): ContextState {
  const { chunks, frontier } = readContextChunkState(path);
  const active = sortedActiveChunks(frontier);
  return {
    chunks,
    messages: readMessagesAfter(path, latestChunkEnd(active)),
  };
}

export function readActiveContextChunks(path: string): SessionContextChunkRecord[] {
  return sortedActiveChunks(readContextChunkState(path).frontier);
}

export function readContextFrontier(path: string): ContextFrontierState {
  return readContextChunkState(path).frontier;
}

function readContextChunkState(path: string): {
  chunks: SessionContextChunkRecord[];
  frontier: ContextFrontierState;
} {
  const frontier = createContextFrontier();
  const chunks: SessionContextChunkRecord[] = [];
  forEachRecordLine(
    path,
    (line) => {
      if (!isContextChunkLine(line)) return;
      const record = parseRecord(line);
      if (record?.type === 'context_chunk' && applyContextChunk(frontier, record)) {
        chunks.push(record);
      }
    },
    { maxLineChars: 1_048_576 },
  );
  return { chunks, frontier };
}

function readMessagesAfter(path: string, watermark: number): SessionMessageRecord[] {
  const messages: SessionMessageRecord[] = [];
  forEachRecordLine(
    path,
    (line) => {
      if (!isMessageLine(line) || messageStoreId(line) <= watermark) return;
      const record = parseRecord(line);
      if (record?.type === 'message') messages.push(record);
    },
    {
      maxLineChars: 4_096,
      retainFullLine: (prefix) =>
        isMessageLine(prefix) ? messageStoreId(prefix) > watermark : false,
    },
  );
  return messages;
}

function isContextChunkLine(line: string): boolean {
  return hasRecordTypePrefix(line, 'context_chunk');
}

function messageStoreId(line: string): number {
  return recordIdFromPrefix(line, 'message', 'store_id') ?? 0;
}

function latestChunkEnd(chunks: readonly SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
