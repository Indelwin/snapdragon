import { appendFileSync, closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { appendRecord, type SessionContextChunkRecord } from './records.js';

export function appendContextRecord(path: string, record: SessionContextChunkRecord): void {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const last = Buffer.alloc(1);
    if (size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 10) {
      // Preserve an interrupted final record without joining the new summary to it.
      appendFileSync(path, '\n');
    }
  } finally {
    closeSync(fd);
  }
  appendRecord(path, record);
}
