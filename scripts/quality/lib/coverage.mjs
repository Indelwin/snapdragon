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
  const candidates = fileCoverage.filter((entry) => overlaps(entry, fn));
  if (candidates.length === 0) return 0;
  const best = candidates.sort((a, b) => span(a) - span(b))[0];
  return coveredLength(best.ranges, fn) / Math.max(1, fn.end - fn.start);
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
