// Shared GEPA types. The optimiser produces and consumes `GepaCandidate`
// objects whose `components` map each target id to its current text.
//
// Each candidate carries two reward views:
//
// - `scores`         — per-task scalars from the *most recent* eval batch,
//                       in batch order. Used for the bandit's mean-score
//                       weighting and for the parent-vs-child improvement
//                       test on the iteration's shared minibatch.
// - `scoresByTask`   — cumulative map of `taskId -> latestScore`. Used by
//                       Pareto selection so dominance compares candidates on
//                       the *same* tasks even when minibatches differ across
//                       iterations (fresh batches per iter would otherwise
//                       make positional comparison meaningless).

import type { TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';
import type { RubricResult } from './rubric-types.js';

export interface GepaCandidate {
  /** Stable id assigned when the candidate is first registered. */
  id: string;
  /** targetId -> candidate text. */
  components: Record<string, string>;
  /** Per-task scores on the *latest* eval batch. Empty until evaluated. */
  scores: number[];
  /** Cumulative taskId -> latest score, across all batches this candidate
   *  has been evaluated on. Drives Pareto dominance. */
  scoresByTask: Record<string, number>;
  /** Cached mean of `scores`. NaN until evaluated. */
  meanScore: number;
  /** Generation number; seed = 0. */
  generation: number;
  /** Ancestor candidate ids (1 for mutation; >1 once crossover lands). */
  parents?: readonly string[];
  /** Which target was edited to produce this candidate, if any. */
  editedTarget?: string;
}

export interface GepaReflectiveDatum {
  example: TaskExample;
  trace: RolloutTrace;
  score: number;
  rubric: RubricResult;
}

export type GepaEvent =
  | { type: 'started'; at: string; seedScore: number }
  | {
      type: 'iteration';
      at: string;
      iteration: number;
      bestScore: number;
      paretoSize: number;
    }
  | {
      type: 'candidate';
      at: string;
      candidateId: string;
      parentId: string;
      target: string;
      minibatchScore: number;
      accepted: boolean;
      reason?: string;
    }
  | {
      type: 'merge';
      at: string;
      candidateId: string;
      parentIds: readonly string[];
      mergedTargets: readonly string[];
      minibatchScore: number;
      accepted: boolean;
    }
  | { type: 'rejected'; at: string; candidateId: string; reason: string }
  | { type: 'completed'; at: string; bestScore: number; iterations: number; evals: number };

export interface GepaOptions {
  /** Hard cap on optimisation iterations. */
  maxIterations: number;
  /** Tasks per minibatch eval (default 5). */
  minibatchSize?: number;
  /** Stop if no improvement for N iterations (default Infinity). */
  earlyStoppingPatience?: number;
  /** Minimum improvement (delta on minibatch mean) to count as progress. */
  minImprovement?: number;
  /** Probability of running a merge step instead of a mutation (default 0). */
  mergeProbability?: number;
  /** Top-K best/worst entries retained per target in feedback memory. */
  memoryTopK?: number;
  /** Deterministic RNG seed. */
  seed?: number;
  signal?: AbortSignal;
  onEvent?: (event: GepaEvent) => void | Promise<void>;
}

export interface GepaReport {
  best: GepaCandidate;
  paretoFront: GepaCandidate[];
  history: GepaCandidate[];
  iterations: number;
  /** Total evaluation calls (one per candidate evaluated). */
  evals: number;
  improved: boolean;
  events: GepaEvent[];
}
