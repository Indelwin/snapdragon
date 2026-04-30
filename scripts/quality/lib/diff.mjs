import { gitMaybe } from './git.mjs';

export async function changedLineRanges(baseRef, file) {
  if (!baseRef) return [];
  const diff = await gitMaybe(['diff', '--unified=0', `${baseRef}...HEAD`, '--', file]);
  if (!diff) return [];
  return parseChangedLineRanges(diff);
}

export function parseChangedLineRanges(diff) {
  const ranges = [];
  for (const line of diff.split('\n')) {
    const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) continue;
    const start = Number(match[1]);
    const length = Number(match[2] ?? '1');
    if (length > 0) ranges.push({ start, end: start + length - 1 });
  }
  return ranges;
}
