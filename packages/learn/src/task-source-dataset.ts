// Dataset-backed TaskSource. Pre-materialised TaskExample[] with stable
// indexing and optional seeded shuffle.

import type { LearningDataset, TaskExample } from './dataset.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';

export interface DatasetTaskSourceOptions {
  /** Shuffle order per sample() call using the supplied seed. */
  shuffle?: boolean;
  /** Override source id (defaults to dataset.id). */
  id?: string;
}

export function datasetTaskSource(
  dataset: LearningDataset,
  options: DatasetTaskSourceOptions = {},
): TaskSource {
  const examples = dataset.examples;
  const id = options.id ?? `dataset:${dataset.id}`;

  return {
    id,
    kind: 'dataset',
    size: examples.length,
    at(index: number): TaskExample {
      if (index < 0 || index >= examples.length) {
        throw new RangeError(
          `datasetTaskSource(${id}): index ${index} out of range [0, ${examples.length})`,
        );
      }
      return examples[index]!;
    },
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      if (examples.length === 0) return;
      const order = orderFor(examples.length, args.seed, options.shuffle ?? false);
      const limit = Math.min(args.count, examples.length);
      for (let i = 0; i < limit; i++) {
        if (args.signal?.aborted) return;
        yield examples[order[i]!]!;
      }
    },
  };
}

function orderFor(length: number, seed: number | undefined, shuffle: boolean): number[] {
  const order = Array.from({ length }, (_, i) => i);
  if (!shuffle) return order;
  const rng = mulberry32(seed ?? 1);
  for (let i = length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
