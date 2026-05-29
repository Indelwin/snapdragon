// Procedural TaskSource: a pure (seed, index) -> TaskExample generator.
// Self-contained, no IO. Useful for unit tests and generative benchmarks
// (math problems, synthetic webtools targets, NPC scenarios, etc).

import type { TaskExample } from './dataset.js';
import type { TaskSource, TaskSourceSampleArgs } from './task-source.js';

export interface ProceduralTaskSourceOptions {
  id: string;
  /** Optional bounded view; omit for an unbounded stream. */
  size?: number;
  generate: (args: { seed: number; index: number }) => TaskExample | Promise<TaskExample>;
}

export function proceduralTaskSource(opts: ProceduralTaskSourceOptions): TaskSource {
  const baseSeed = (id: string) => hashString(id);
  return {
    id: opts.id,
    kind: 'procedural',
    size: opts.size,
    async *sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample> {
      const seed = args.seed ?? baseSeed(opts.id);
      const bound = opts.size === undefined ? args.count : Math.min(args.count, opts.size);
      for (let i = 0; i < bound; i++) {
        if (args.signal?.aborted) return;
        yield await opts.generate({ seed, index: i });
      }
    },
  };
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
