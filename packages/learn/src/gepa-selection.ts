// Pareto-front selection for GEPA.
//
// Dominance is computed on `scoresByTask`, the cumulative `taskId -> score`
// map maintained by `evaluateCandidate`. This is critical when minibatches
// vary across iterations: positional comparison of `scores` would otherwise
// pit candidates against each other on *different* tasks and yield bogus
// dominance. With keyed scores, A dominates B iff there is a non-empty
// overlap of tasks they have both seen AND A is >= B on every shared task
// AND strictly > on at least one. Candidates with no overlap are incomparable
// (neither dominates) and both stay on the front.
//
// Parent sampling weights by mean score (greedy term, from the latest batch
// `scores` so improvements show up immediately) plus a uniform exploration
// term so under-explored regions are not starved.

import { clamp01, safeMean } from './gepa-rng.js';
import type { GepaCandidate } from './gepa-types.js';

export { seededRng } from './gepa-rng.js';

/**
 * Return the Pareto-non-dominated subset of `candidates`. Candidates that
 * have not been evaluated on any task yet are excluded.
 */
export function paretoFront(candidates: readonly GepaCandidate[]): GepaCandidate[] {
  const scored = candidates.filter((c) => Object.keys(c.scoresByTask).length > 0);
  return scored.filter((c) => !scored.some((other) => other !== c && dominates(other, c)));
}

/**
 * Task-id-keyed Pareto dominance: `a` dominates `b` iff there is a non-empty
 * intersection of task ids in `scoresByTask`, AND for every shared id
 * `a.scoresByTask[id] >= b.scoresByTask[id]`, AND strict > on at least one.
 * Disjoint candidates (no shared tasks) are incomparable and never dominate.
 */
export function dominates(a: GepaCandidate, b: GepaCandidate): boolean {
  let strictlyBetter = false;
  let overlap = 0;
  for (const [taskId, av] of Object.entries(a.scoresByTask)) {
    const bv = b.scoresByTask[taskId];
    if (bv === undefined) continue;
    overlap += 1;
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return overlap > 0 && strictlyBetter;
}

export interface ParentSamplerOptions {
  /** Exploration weight in [0,1]. 0 = greedy on mean score; 1 = uniform. */
  exploration?: number;
  rng?: () => number;
}

/**
 * Sample a parent candidate from the Pareto front. Throws when the front is
 * empty (the seed candidate should always be on the front once scored).
 */
export function selectParent(
  front: readonly GepaCandidate[],
  options: ParentSamplerOptions = {},
): GepaCandidate {
  if (front.length === 0) throw new Error('selectParent: pareto front is empty');
  if (front.length === 1) return front[0] as GepaCandidate;
  const rng = options.rng ?? Math.random;
  const exploration = clamp01(options.exploration ?? 0.2);
  const weights = computeWeights(front, exploration);
  return weightedPick(front, weights, rng());
}

function computeWeights(front: readonly GepaCandidate[], exploration: number): number[] {
  const means = front.map((c) => safeMean(c.scores));
  const min = Math.min(...means);
  const max = Math.max(...means);
  const span = max - min;
  const uniform = 1 / front.length;
  return means.map((mean) => weightFor(mean, min, span, uniform, exploration));
}

function weightFor(
  mean: number,
  min: number,
  span: number,
  uniform: number,
  exploration: number,
): number {
  const greedy = span === 0 ? uniform : (mean - min) / span;
  return exploration * uniform + (1 - exploration) * greedy;
}

function weightedPick<T>(items: readonly T[], weights: readonly number[], roll: number): T {
  const total = sum(weights);
  if (total === 0) return items[Math.floor(roll * items.length)] as T;
  let cursor = roll * total;
  for (let i = 0; i < items.length; i += 1) {
    cursor -= weights[i] as number;
    if (cursor <= 0) return items[i] as T;
  }
  return items[items.length - 1] as T;
}

function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
