export interface PreviewLinesResult {
  lines: string[];
  truncated: boolean;
}

export function previewLines(
  value: string,
  maxLines: number,
  maxChars: number,
): PreviewLinesResult {
  const lines: string[] = [];
  let start = 0;
  let index = 0;
  while (shouldScan(value, lines.length, index, maxLines, maxChars)) {
    if (value[index] === '\n') {
      lines.push(value.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  const limit = Math.min(value.length, maxChars);
  if (lines.length < maxLines && start < limit) lines.push(value.slice(start, limit));
  return { lines, truncated: index < value.length };
}

function shouldScan(
  value: string,
  lineCount: number,
  index: number,
  maxLines: number,
  maxChars: number,
): boolean {
  return index < value.length && lineCount < maxLines && index < maxChars;
}
