import type { MixedSourceWeight } from './task-source-mixed-types.js';

export function computeMixedSize(sources: readonly MixedSourceWeight[]): number | undefined {
  let total = 0;
  for (const slot of sources) {
    if (slot.source.size === undefined) return undefined;
    total += slot.source.size;
  }
  return total;
}

export function allocateMixedCounts(
  sources: readonly MixedSourceWeight[],
  totalWeight: number,
  count: number,
): number[] {
  const raw = sources.map((s) => (s.weight / totalWeight) * count);
  const counts = raw.map((value) => Math.floor(value));
  distributeRemainder(counts, fractionalRemainders(raw), count);
  return counts;
}

function distributeRemainder(
  counts: number[],
  remainders: readonly { index: number; frac: number }[],
  count: number,
): void {
  let allocated = counts.reduce((sum, value) => sum + value, 0);
  for (const item of remainders) {
    if (allocated >= count) break;
    counts[item.index] = (counts[item.index] ?? 0) + 1;
    allocated += 1;
  }
}

function fractionalRemainders(raw: readonly number[]): { index: number; frac: number }[] {
  return raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
}
