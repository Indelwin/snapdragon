import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';
import {
  appendLineFragment,
  emptyPendingLine,
  type PendingLine,
  visitPendingLine,
} from './record-line-buffer.js';
import type { RecordLineReaderOptions } from './record-line-types.js';

export type { RecordLineReaderOptions } from './record-line-types.js';

export function forEachRecordLine(
  path: string,
  visit: (line: string, truncated: boolean) => void,
  options: RecordLineReaderOptions = {},
): void {
  if (!existsSync(path)) return;
  const fd = openSync(path, 'r');
  try {
    readRecordLines(fd, visit, options);
  } finally {
    closeSync(fd);
  }
}

function readRecordLines(
  fd: number,
  visit: (line: string, truncated: boolean) => void,
  options: RecordLineReaderOptions,
): void {
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = emptyPendingLine();
  for (;;) {
    const bytes = readSync(fd, buffer, 0, buffer.length, null);
    if (bytes === 0) break;
    pending = visitDecodedChunk(decoder.write(buffer.subarray(0, bytes)), pending, visit, options);
  }
  appendLineFragment(pending, decoder.end(), options);
  visitPendingLine(pending, visit);
}

function visitDecodedChunk(
  text: string,
  pending: PendingLine,
  visit: (line: string, truncated: boolean) => void,
  options: RecordLineReaderOptions,
): PendingLine {
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    if (newline === -1) {
      appendLineFragment(pending, text.slice(start), options);
      return pending;
    }
    appendLineFragment(pending, text.slice(start, newline), options);
    visitPendingLine(pending, visit);
    pending = emptyPendingLine();
    start = newline + 1;
  }
}
