// Mixed TaskSource: weighted draw across multiple sources. Useful for
// curriculum schedules (e.g. 70% procedural + 30% replay) and for combining
// dataset shards with live env tasks during evaluation.

import type { TaskExample } from './dataset.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';

export interface MixedSourceWeight {
  source: TaskSource;
  weight: number;
}

export interface MixedTaskSourceOptions {
  id: string;
  sources: readonly MixedSourceWeight[];
}

export function mixedTaskSource(opts: MixedTaskSourceOptions): TaskSource {
  if (opts.sources.length === 0) {
    throw new Error('mixedTaskSource: at least one source required');
  }
  const totalWeight = opts.sources.reduce((sum, w) => sum + w.weight, 0);
  if (totalWeight <= 0) {
    throw new Error('mixedTaskSource: total weight must be positive');
  }
  const size = computeSize(opts.sources);
  return {
    id: opts.id,
    kind: 'mixed',
    size,
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      const counts = allocateCounts(opts.sources, totalWeight, args.count);
      for (let i = 0; i < opts.sources.length; i++) {
        const slot = opts.sources[i]!;
        const allotted = counts[i]!;
        if (allotted <= 0) continue;
        const subSeed = args.seed === undefined ? undefined : (args.seed + i * 2654435761) >>> 0;
        for await (const task of slot.source.sample({
          count: allotted,
          seed: subSeed,
          signal: args.signal,
        })) {
          if (args.signal?.aborted) return;
          yield task;
        }
      }
    },
  };
}

function computeSize(sources: readonly MixedSourceWeight[]): number | undefined {
  let total = 0;
  for (const slot of sources) {
    if (slot.source.size === undefined) return undefined;
    total += slot.source.size;
  }
  return total;
}

function allocateCounts(
  sources: readonly MixedSourceWeight[],
  totalWeight: number,
  count: number,
): number[] {
  const raw = sources.map((s) => (s.weight / totalWeight) * count);
  const counts = raw.map((value) => Math.floor(value));
  let allocated = counts.reduce((sum, value) => sum + value, 0);
  // Distribute remainder by largest fractional part.
  const remainders = raw
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  let cursor = 0;
  while (allocated < count && cursor < remainders.length) {
    counts[remainders[cursor]!.index]! += 1;
    allocated += 1;
    cursor += 1;
  }
  return counts;
}
