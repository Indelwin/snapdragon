import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function readCoverage(dir) {
  const coverage = new Map();
  const files = await readdir(dir).catch(() => []);
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    mergeCoverage(coverage, JSON.parse(await readFile(`${dir}/${file}`, 'utf8')));
  }
  return coverage;
}

export function functionCoverage(fileCoverage, fn) {
  if (!fileCoverage) return 0;
  // Match by name first — TS source byte offsets and V8's compiled-JS
  // offsets drift apart for files heavy in type annotations, so positional
  // overlap can miss real coverage. Names are unique enough in practice
  // for our quality gates; only fall back to overlap when nothing matches
  // (e.g. anonymous arrow functions).
  const named =
    fn.name && fn.name !== '<anonymous>'
      ? fileCoverage.filter((entry) => entry.functionName === fn.name)
      : [];
  const candidates = named.length > 0 ? named : fileCoverage.filter((entry) => overlaps(entry, fn));
  if (candidates.length === 0) return 0;
  const best = candidates.sort((a, b) => span(a) - span(b))[0];
  return coveredFraction(best.ranges, fn);
}

function coveredFraction(ranges, fn) {
  // When matching by name, the V8 ranges live in compiled-JS offset space
  // and don't line up with the TS source span. Treat the V8 entry's first
  // range as the function body and measure covered fraction within that.
  const first = ranges[0];
  if (first.startOffset >= fn.start && first.endOffset <= fn.end + (fn.end - fn.start)) {
    // Likely positional alignment — measure against the TS span.
    return coveredLength(ranges, fn) / Math.max(1, fn.end - fn.start);
  }
  // Compiled-JS entry — measure relative to the V8 entry's own span.
  let covered = 0;
  for (let i = 1; i < ranges.length; i += 1) {
    if (ranges[i].count === 0) covered += ranges[i].endOffset - ranges[i].startOffset;
  }
  const total = first.endOffset - first.startOffset;
  return first.count > 0 ? Math.max(0, total - covered) / Math.max(1, total) : 0;
}

function mergeCoverage(coverage, payload) {
  for (const script of payload.result ?? []) {
    const file = scriptPath(script.url);
    if (!file) continue;
    const entries = script.functions.filter((fn) => usefulFunction(fn));
    if (entries.length > 0) coverage.set(file, [...(coverage.get(file) ?? []), ...entries]);
  }
}

function usefulFunction(fn) {
  return fn.functionName !== '' && fn.functionName !== '__name' && fn.ranges.length > 0;
}

function scriptPath(url) {
  if (!url.startsWith('file://')) return undefined;
  const file = fileURLToPath(url);
  return /\.(ts|tsx|js|jsx)$/.test(file) ? file : undefined;
}

function overlaps(entry, fn) {
  const first = entry.ranges[0];
  return first.startOffset < fn.end && first.endOffset > fn.start;
}

function span(entry) {
  const first = entry.ranges[0];
  return first.endOffset - first.startOffset;
}

function coveredLength(ranges, fn) {
  const points = coveragePoints(ranges, fn);
  let covered = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (segmentCovered(ranges, start, end)) covered += end - start;
  }
  return covered;
}

function coveragePoints(ranges, fn) {
  const points = new Set([fn.start, fn.end]);
  for (const range of ranges) {
    const start = Math.max(range.startOffset, fn.start);
    const end = Math.min(range.endOffset, fn.end);
    if (end > start) {
      points.add(start);
      points.add(end);
    }
  }
  return [...points].sort((a, b) => a - b);
}

function segmentCovered(ranges, start, end) {
  const containing = ranges.filter((range) => range.startOffset <= start && range.endOffset >= end);
  if (containing.length === 0) return false;
  const innermost = containing.sort((a, b) => rangeSpan(a) - rangeSpan(b))[0];
  return innermost.count > 0;
}

function rangeSpan(range) {
  return range.endOffset - range.startOffset;
}
