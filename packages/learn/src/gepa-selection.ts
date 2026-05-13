// Pareto-front selection for GEPA.
//
// We treat each candidate's per-task `scores` vector as a point in
// task-reward space. A candidate is on the Pareto front when no other
// candidate weakly dominates it (>= on every task and > on at least one). The
// optimiser samples a parent from the front weighted by mean score plus a
// uniform exploration term, so dominated-but-not-yet-explored regions don't
// get starved.

import { clamp01, safeMean } from './gepa-rng.js';
import type { GepaCandidate } from './gepa-types.js';

export { seededRng } from './gepa-rng.js';

/**
 * Return the Pareto-non-dominated subset of `candidates`. Candidates without
 * any scores (uninitialised) are excluded.
 */
export function paretoFront(candidates: readonly GepaCandidate[]): GepaCandidate[] {
  const scored = candidates.filter((c) => c.scores.length > 0);
  return scored.filter((c) => !scored.some((other) => other !== c && dominates(other, c)));
}

/**
 * Strict Pareto dominance: `a` dominates `b` iff a.scores[i] >= b.scores[i]
 * for all i and a.scores[j] > b.scores[j] for at least one j. Score vectors
 * of different lengths are compared only on their overlap.
 */
export function dominates(a: GepaCandidate, b: GepaCandidate): boolean {
  const length = Math.min(a.scores.length, b.scores.length);
  if (length === 0) return false;
  let strictlyBetter = false;
  for (let i = 0; i < length; i += 1) {
    const av = a.scores[i] as number;
    const bv = b.scores[i] as number;
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
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
