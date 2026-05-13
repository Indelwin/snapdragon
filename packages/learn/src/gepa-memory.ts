// Feedback memory for GEPA.
//
// The optimiser accumulates reflective evidence (rollout + rubric per task)
// from every candidate eval. Proposers benefit from *cumulative* signal —
// "here are the worst-scoring cases we've seen across all iterations on
// this target" — rather than only the most recent minibatch. This module
// rolls evidence up per target and exposes a compact `GepaTargetMemory`
// summary that adapters pass to `proposeNewText`.
//
// Storage is bounded: we keep top-K best and bottom-K worst datums per
// target by score, plus a small ring of recent batch means.

import type { GepaReflectiveDatum } from './gepa-types.js';

export interface GepaTargetMemory {
  /** Target this rollup belongs to. */
  targetId: string;
  /** Highest-scoring evaluations seen, descending by score. */
  best: GepaReflectiveDatum[];
  /** Lowest-scoring evaluations seen, ascending by score. */
  worst: GepaReflectiveDatum[];
  /** Per-batch mean scores in arrival order (oldest first). */
  recentMeans: number[];
  /** Total reflective datums ever recorded for this target. */
  observations: number;
}

export interface GepaFeedbackMemoryOptions {
  /** Max best/worst entries kept per target (default 5). */
  topK?: number;
  /** Max recent-batch-mean ring length (default 20). */
  recentLimit?: number;
}

export interface GepaFeedbackMemory {
  /** Record a batch of reflective datums for a target. */
  record(targetId: string, data: readonly GepaReflectiveDatum[]): void;
  /** Snapshot of the rollup for a target. */
  summarize(targetId: string): GepaTargetMemory;
  /** All target ids with at least one observation. */
  targets(): string[];
}

interface MemoryState {
  best: GepaReflectiveDatum[];
  worst: GepaReflectiveDatum[];
  recentMeans: number[];
  observations: number;
}

export function gepaFeedbackMemory(options: GepaFeedbackMemoryOptions = {}): GepaFeedbackMemory {
  const topK = Math.max(1, options.topK ?? 5);
  const recentLimit = Math.max(1, options.recentLimit ?? 20);
  const states = new Map<string, MemoryState>();

  function state(targetId: string): MemoryState {
    let entry = states.get(targetId);
    if (!entry) {
      entry = { best: [], worst: [], recentMeans: [], observations: 0 };
      states.set(targetId, entry);
    }
    return entry;
  }

  return {
    record(targetId, data) {
      if (data.length === 0) return;
      const entry = state(targetId);
      entry.observations += data.length;
      entry.recentMeans.push(meanOf(data));
      if (entry.recentMeans.length > recentLimit) entry.recentMeans.shift();
      for (const datum of data) {
        insertSorted(entry.best, datum, topK, (a, b) => b.score - a.score);
        insertSorted(entry.worst, datum, topK, (a, b) => a.score - b.score);
      }
    },
    summarize(targetId) {
      const entry = state(targetId);
      return {
        targetId,
        best: [...entry.best],
        worst: [...entry.worst],
        recentMeans: [...entry.recentMeans],
        observations: entry.observations,
      };
    },
    targets() {
      return [...states.keys()];
    },
  };
}

function insertSorted<T>(
  bucket: T[],
  item: T,
  capacity: number,
  compare: (a: T, b: T) => number,
): void {
  bucket.push(item);
  bucket.sort(compare);
  if (bucket.length > capacity) bucket.length = capacity;
}

function meanOf(data: readonly GepaReflectiveDatum[]): number {
  if (data.length === 0) return 0;
  return data.reduce((sum, datum) => sum + datum.score, 0) / data.length;
}
