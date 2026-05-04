import { closeSync, openSync, readSync } from 'node:fs';
import type { SessionRecord } from '../records.js';

const READ_CHUNK = 1 << 16; // 64 KiB
export const MAX_JSONL_INDEX_RECORD_BYTES = 1 << 20; // 1 MiB

export type TailReadResult = { records: SessionRecord[]; bytesRead: number };

/**
 * Read JSONL records starting at `startOffset`. Returns the parsed records and
 * the number of bytes consumed up to the last newline (so a partially-written
 * trailing line is left for the next sync pass).
 */
export function readJsonlFromOffset(path: string, startOffset: number): TailReadResult {
  const fd = openSync(path, 'r');
  try {
    return readAllChunks(fd, startOffset);
  } finally {
    closeSync(fd);
  }
}

function readAllChunks(fd: number, startOffset: number): TailReadResult {
  const buf = Buffer.alloc(READ_CHUNK);
  const records: SessionRecord[] = [];
  let buffered = '';
  let position = startOffset;
  let consumed = 0;

  while (true) {
    const bytes = readSync(fd, buf, 0, buf.length, position);
    if (bytes <= 0) break;
    buffered += buf.subarray(0, bytes).toString('utf8');
    position += bytes;
    const drained = drainCompleteLines(buffered, records);
    buffered = drained.remainder;
    consumed += drained.consumed;
  }
  return { records, bytesRead: consumed };
}

function drainCompleteLines(
  buffered: string,
  records: SessionRecord[],
): { remainder: string; consumed: number } {
  let consumed = 0;
  let remainder = buffered;
  let nl = remainder.indexOf('\n');
  while (nl !== -1) {
    const line = remainder.slice(0, nl);
    const lineBytes = Buffer.byteLength(line, 'utf8') + 1; // +1 for '\n'
    consumed += lineBytes;
    if (shouldParseLine(line, lineBytes)) {
      const trimmed = line.trim();
      const parsed = parseLine(trimmed);
      if (parsed) records.push(parsed);
    }
    remainder = remainder.slice(nl + 1);
    nl = remainder.indexOf('\n');
  }
  return { remainder, consumed };
}

function shouldParseLine(line: string, lineBytes: number): boolean {
  return lineBytes <= MAX_JSONL_INDEX_RECORD_BYTES && line.trim().length > 0;
}

function parseLine(line: string): SessionRecord | undefined {
  try {
    return JSON.parse(line) as SessionRecord;
  } catch {
    return undefined;
  }
}
