import { parseRecentMessageRecord } from './recent-record-parse.js';
import type { SessionMessageRecord } from './records.js';

const MAX_TAIL_LINE_BYTES = 256 * 1024;

export interface ReverseTailState {
  records: SessionMessageRecord[];
  oversizedLines: number;
  lineBytes: number;
  lineParts: Buffer[];
  oversized: boolean;
}

export function collectReverseLines(chunk: Buffer, state: ReverseTailState, limit: number): void {
  let end = chunk.length;
  for (let index = chunk.length - 1; index >= 0 && state.records.length < limit; index -= 1) {
    if (chunk[index] !== 10) continue;
    prependLinePart(state, chunk.subarray(index + 1, end));
    visitTailLine(state, limit);
    resetTailLine(state);
    end = index;
  }
  if (end > 0 && state.records.length < limit) prependLinePart(state, chunk.subarray(0, end));
}

export function visitTailLine(state: ReverseTailState, limit: number): void {
  if (state.oversized) {
    state.oversizedLines += 1;
    return;
  }
  if (state.lineParts.length === 0 || state.records.length >= limit) return;
  const record = parseRecentMessageRecord(Buffer.concat(state.lineParts).toString('utf8').trim());
  if (record) state.records.push(record);
}

function prependLinePart(state: ReverseTailState, part: Uint8Array): void {
  if (part.length === 0 || state.oversized) return;
  state.lineBytes += part.length;
  if (state.lineBytes > MAX_TAIL_LINE_BYTES) {
    state.lineParts.length = 0;
    state.oversized = true;
    return;
  }
  state.lineParts.unshift(Buffer.from(part));
}

function resetTailLine(state: ReverseTailState): void {
  state.lineBytes = 0;
  state.lineParts.length = 0;
  state.oversized = false;
}
