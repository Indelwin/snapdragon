import { wrapText } from './text-wrap.js';
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

function continuationPrefix(prefix: string): string | undefined {
  return prefix.length > 0 ? ' '.repeat(prefix.length) : undefined;
}
