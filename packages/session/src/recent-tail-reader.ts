import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { SessionMessageRecord } from './records.js';
import { collectReverseLines, type ReverseTailState, visitTailLine } from './reverse-tail-lines.js';

const TAIL_CHUNK_BYTES = 64 * 1024;

export interface TailMessagesResult {
  records: SessionMessageRecord[];
  oversizedLines: number;
}

export function readTailMessages(path: string, limit: number): TailMessagesResult {
  const fd = openSync(path, 'r');
  const state: ReverseTailState = {
    records: [],
    oversizedLines: 0,
    lineBytes: 0,
    lineParts: [],
    oversized: false,
  };
  let position = statSync(path).size;
  try {
    while (position > 0 && state.records.length < limit) {
      const length = Math.min(TAIL_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      readSync(fd, chunk, 0, length, position);
      collectReverseLines(chunk, state, limit);
    }
    if (position === 0 && state.records.length < limit) visitTailLine(state, limit);
  } finally {
    closeSync(fd);
  }
  return { records: state.records.reverse(), oversizedLines: state.oversizedLines };
}
