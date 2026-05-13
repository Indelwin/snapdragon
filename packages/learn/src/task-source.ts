// TaskSource: a unified iterator over task examples for eval / GEPA / SFT / RL.
//
// Live environments are first-class: a TaskSource is anything that can produce
// TaskExample instances on demand. Pre-generated datasets are just one special
// case (bounded, deterministic at(i)). Process sandboxes, HTTP gym-style
// servers, replay logs, and procedural generators all expose the same surface.
//
// Design rules:
// - `size` is undefined for unbounded/streaming sources. Consumers must not
//   assume a stable index; use `sample()` to draw a batch instead.
// - `sample()` returns an async iterable so streaming sources can yield tasks
//   as they are produced without buffering.
// - `at(i)` is optional and only meaningful for bounded sources that promise
//   stable indexing (datasets); GEPA's per-instance Pareto fronts use it.
// - `close()` lets envs release containers / sockets / browser sessions.

import type { TaskExample } from './dataset.js';

export type TaskSourceKind = 'dataset' | 'process' | 'http' | 'procedural' | 'mixed';

export interface TaskSourceSampleArgs {
  count: number;
  seed?: number;
  signal?: AbortSignal;
}

export interface TaskSource {
  readonly id: string;
  readonly kind: TaskSourceKind;
  /** Total known size, or undefined for unbounded / streaming. */
  readonly size?: number;
  /** Sample N tasks. Implementations decide deterministic vs stochastic. */
  sample(args: TaskSourceSampleArgs): AsyncIterable<TaskExample>;
  /** Stable indexed access where supported (dataset mode). */
  at?(index: number): Promise<TaskExample> | TaskExample;
  /** Release any held resources. */
  close?(): Promise<void> | void;
}

/** Pull a TaskSource into a concrete array of length `count`. */
export async function collectTasks(
  source: TaskSource,
  count: number,
  seed?: number,
  signal?: AbortSignal,
): Promise<TaskExample[]> {
  const out: TaskExample[] = [];
  for await (const task of source.sample({ count, seed, signal })) {
    out.push(task);
    if (out.length >= count) break;
  }
  return out;
}

/** True when the source supports stable per-index Pareto fronts. */
export function isBoundedSource(source: TaskSource): boolean {
  return typeof source.size === 'number' && typeof source.at === 'function';
}
