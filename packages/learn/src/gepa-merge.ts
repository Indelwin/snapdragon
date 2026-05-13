// GEPA-Merge step: combine two Pareto-front parents on targets where their
// components differ, producing a single child. This is the crossover half
// of the "merge + mutation" pair in the ax-llm GEPA reference.
//
// Strategy (kept deliberately simple for the v1 cut):
//   1. Identify the set of target ids where parent_a and parent_b have
//      different component texts ("disjoint targets").
//   2. If none, signal `no-disjoint-targets` and let the caller fall back
//      to mutation.
//   3. Otherwise, for each disjoint target, draw from {a, b} uniformly
//      (deterministic under the supplied rng) and assemble the child.
//
// Future work (scored merge): weight the per-target draws by each parent's
// per-task contribution. Out of scope for v1 because it requires per-target
// score attribution which we don't yet collect.

import type { GepaCandidate } from './gepa-types.js';

export interface MergeArgs {
  parentA: GepaCandidate;
  parentB: GepaCandidate;
  rng: () => number;
}

export interface MergeProposal {
  components: Record<string, string>;
  mergedTargets: string[];
  source: Record<string, 'a' | 'b'>;
}

export function disjointTargets(a: GepaCandidate, b: GepaCandidate): string[] {
  const ids = new Set<string>([...Object.keys(a.components), ...Object.keys(b.components)]);
  const out: string[] = [];
  for (const id of ids) {
    if (a.components[id] !== b.components[id]) out.push(id);
  }
  return out.sort();
}

/**
 * Build a merge child from two parents. Returns `null` when the parents
 * have no disjoint targets (caller should fall back to mutation).
 */
export function buildMergeChild(args: MergeArgs): MergeProposal | null {
  const disjoint = disjointTargets(args.parentA, args.parentB);
  if (disjoint.length === 0) return null;
  const components: Record<string, string> = { ...args.parentA.components };
  const source: Record<string, 'a' | 'b'> = {};
  for (const id of disjoint) {
    const fromA = args.rng() < 0.5;
    source[id] = fromA ? 'a' : 'b';
    const parent = fromA ? args.parentA : args.parentB;
    const value = parent.components[id];
    if (value !== undefined) components[id] = value;
    else delete components[id];
  }
  return { components, mergedTargets: disjoint, source };
}

/**
 * Pick a distinct pair from the Pareto front. Returns `null` if there
 * aren't at least two distinct candidates.
 */
export function pickMergePair(
  front: readonly GepaCandidate[],
  rng: () => number,
): [GepaCandidate, GepaCandidate] | null {
  if (front.length < 2) return null;
  const a = front[Math.floor(rng() * front.length)] as GepaCandidate;
  let b = front[Math.floor(rng() * front.length)] as GepaCandidate;
  let guard = 0;
  while (b === a && guard < 8) {
    b = front[Math.floor(rng() * front.length)] as GepaCandidate;
    guard += 1;
  }
  if (b === a) return null;
  return [a, b];
}
