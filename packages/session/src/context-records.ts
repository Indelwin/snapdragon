import type { ContextState } from './context-window.js';
import { forEachRecordLine } from './record-line-reader.js';
import {
  isMessageLine,
  numberField,
  parseRecord,
  type SessionContextChunkRecord,
  type SessionMessageRecord,
} from './records.js';

export function readCompactedContextState(path: string): ContextState {
  const chunks = readContextChunks(path);
  return {
    chunks,
    messages: readMessagesAfter(path, latestChunkEnd(chunks)),
  };
}

function readContextChunks(path: string): SessionContextChunkRecord[] {
  const chunks: SessionContextChunkRecord[] = [];
  forEachRecordLine(path, (line) => {
    if (!isContextChunkLine(line)) return;
    const record = parseRecord(line);
    if (record?.type === 'context_chunk') chunks.push(record);
  });
  return chunks;
}

function readMessagesAfter(path: string, watermark: number): SessionMessageRecord[] {
  const messages: SessionMessageRecord[] = [];
  forEachRecordLine(path, (line) => {
    if (!isMessageLine(line) || numberField(line, 'store_id') <= watermark) return;
    const record = parseRecord(line);
    if (record?.type === 'message') messages.push(record);
  });
  return messages;
}

function isContextChunkLine(line: string): boolean {
  return line.includes('"type":"context_chunk"') || line.includes('"type": "context_chunk"');
}

function latestChunkEnd(chunks: readonly SessionContextChunkRecord[]): number {
  return chunks.reduce((end, chunk) => Math.max(end, chunk.range_end), 0);
}
