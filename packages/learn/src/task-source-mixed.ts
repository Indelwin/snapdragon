// Mixed TaskSource: weighted draw across multiple sources. Useful for
// curriculum schedules (e.g. 70% procedural + 30% replay) and for combining
// dataset shards with live env tasks during evaluation.

import type { TaskExample } from './dataset.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';
import { computeMixedSize } from './task-source-mixed-plan.js';
import { sampleMixedTasks } from './task-source-mixed-sample.js';
import type { MixedSourceWeight } from './task-source-mixed-types.js';

export type { MixedSourceWeight } from './task-source-mixed-types.js';

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
  return {
    id: opts.id,
    kind: 'mixed',
    size: computeMixedSize(opts.sources),
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      yield* sampleMixedTasks(opts.sources, totalWeight, args);
    },
  };
}
