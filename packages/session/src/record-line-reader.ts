import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { StringDecoder } from 'node:string_decoder';

export function forEachRecordLine(path: string, visit: (line: string) => void): void {
  if (!existsSync(path)) return;
  const fd = openSync(path, 'r');
  try {
    readRecordLines(fd, visit);
  } finally {
    closeSync(fd);
  }
}

function readRecordLines(fd: number, visit: (line: string) => void): void {
  const decoder = new StringDecoder('utf8');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let pending = '';
  for (;;) {
    const bytes = readSync(fd, buffer, 0, buffer.length, null);
    if (bytes === 0) break;
    pending += decoder.write(buffer.subarray(0, bytes));
    pending = visitCompleteLines(pending, visit);
  }
  visitRecordLine(pending + decoder.end(), visit);
}

function visitCompleteLines(text: string, visit: (line: string) => void): string {
  let start = 0;
  for (;;) {
    const newline = text.indexOf('\n', start);
    if (newline === -1) return text.slice(start);
    visitRecordLine(text.slice(start, newline), visit);
    start = newline + 1;
  }
}

function visitRecordLine(line: string, visit: (line: string) => void): void {
  const trimmed = line.trim();
  if (trimmed) visit(trimmed);
}
