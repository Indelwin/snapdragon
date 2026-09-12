import { gitMaybe } from './git.mjs';

export async function changedLineRanges(baseRef, file, options) {
  if (!baseRef) return [];
  const diff = await gitMaybe(['diff', '--unified=0', baseRef, '--', file], options);
  if (!diff) {
    const tracked = await gitMaybe(['ls-files', '--error-unmatch', '--', file], options);
    return tracked === undefined ? [{ start: 1, end: Number.MAX_SAFE_INTEGER }] : [];
  }
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
