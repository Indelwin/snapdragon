import type { TranscriptRow } from './transcript-window.js';

export function wrapTranscriptRows(
  rows: readonly TranscriptRow[],
  viewportColumns: number,
): TranscriptRow[] {
  const columns = Math.max(12, Math.floor(viewportColumns));
  return rows.flatMap((row) => wrapRow(row, columns));
}

function wrapRow(row: TranscriptRow, columns: number): TranscriptRow[] {
  if (row.kind === 'spacer') return [row];
  const prefix = row.prefix ?? '';
  const width = Math.max(8, columns - prefix.length);
  const chunks = wrapText(row.text ?? '', width);
  return chunks.map((chunk, index) => ({
    ...row,
    key: `${row.key}-wrap-${index}`,
    prefix: index === 0 ? row.prefix : continuationPrefix(prefix),
    prefixBold: index === 0 ? row.prefixBold : false,
    text: chunk,
    cursor: row.cursor && index === chunks.length - 1,
  }));
}

function wrapText(text: string, width: number): string[] {
  if (text.length === 0) return [''];
  const chunks: string[] = [];
  for (const line of text.split('\n')) appendWrappedLine(chunks, line, width);
  return chunks;
}

function appendWrappedLine(chunks: string[], line: string, width: number): void {
  if (line.length === 0) {
    chunks.push('');
    return;
  }
  let rest = line;
  while (rest.length > width) {
    const breakAt = softBreak(rest, width);
    chunks.push(rest.slice(0, breakAt).trimEnd());
    rest = rest.slice(breakAt).trimStart();
  }
  chunks.push(rest);
}

function softBreak(text: string, width: number): number {
  const slice = text.slice(0, width + 1);
  const whitespace = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\t'));
  return whitespace > Math.floor(width * 0.45) ? whitespace : width;
}

function continuationPrefix(prefix: string): string | undefined {
  return prefix.length > 0 ? ' '.repeat(prefix.length) : undefined;
}
