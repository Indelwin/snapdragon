// GEPA adapter surface — the only place GEPA touches the outside world.
//
// The optimiser is intentionally agnostic about *how* a candidate's component
// texts shape an agent's behaviour. The caller supplies a `GepaAdapter` that
// knows how to:
//
//   1. `evaluate(candidate, targets, tasks)` — run rollouts under the
//      candidate's component texts, score them, and return per-task scores
//      plus reflective evidence (the rubric + rollout per task).
//
//   2. `proposeNewText(target, current, feedback)` — produce a new candidate
//      text for one target, given the reflective evidence from a recent
//      evaluation of the parent. This is where an LLM-based reflector plugs
//      in; for tests and offline runs we ship `manualProposer`.
//
// A default factory `gepaAdapter({ runRollout, rubric, proposeNewText })`
// composes these from a rollout function and rubric (the same primitives used
// by `evaluateSource`), so callers rarely write the adapter from scratch.

import type { TaskExample } from './dataset.js';
import type { GepaTargetMemory } from './gepa-memory.js';
import type { GepaTarget } from './gepa-target.js';
import type { GepaCandidate, GepaReflectiveDatum } from './gepa-types.js';
import type { RolloutTrace } from './rollout.js';
import type { Rubric } from './rubric-types.js';

export interface GepaEvaluateArgs {
  candidate: GepaCandidate;
  targets: readonly GepaTarget[];
  tasks: readonly TaskExample[];
  signal?: AbortSignal;
}

export interface GepaEvaluateResult {
  scores: number[];
  data: GepaReflectiveDatum[];
}

export interface GepaProposeArgs {
  target: GepaTarget;
  current: string;
  /** Reflective evidence from the most recent parent evaluation. */
  feedback: readonly GepaReflectiveDatum[];
  /** Cumulative best/worst rollup for this target across the whole run. */
  memory?: GepaTargetMemory;
  signal?: AbortSignal;
}

export interface GepaAdapter {
  evaluate(args: GepaEvaluateArgs): Promise<GepaEvaluateResult>;
  proposeNewText(args: GepaProposeArgs): Promise<string>;
}

export type GepaRolloutRunner = (
  candidate: GepaCandidate,
  targets: readonly GepaTarget[],
  example: TaskExample,
  signal?: AbortSignal,
) => Promise<RolloutTrace>;

export type GepaProposer = (args: GepaProposeArgs) => Promise<string>;

export interface GepaAdapterOptions {
  runRollout: GepaRolloutRunner;
  rubric: Rubric;
  proposeNewText: GepaProposer;
}

/** Compose a `GepaAdapter` from a rollout function, rubric, and proposer. */
export function gepaAdapter(options: GepaAdapterOptions): GepaAdapter {
  return {
    async evaluate(args) {
      const scores: number[] = [];
      const data: GepaReflectiveDatum[] = [];
      for (const example of args.tasks) {
        if (args.signal?.aborted) break;
        const trace = await options.runRollout(args.candidate, args.targets, example, args.signal);
        const rubric = await options.rubric.evaluate(example, trace);
        scores.push(rubric.score);
        data.push({ example, trace, score: rubric.score, rubric });
      }
      return { scores, data };
    },
    proposeNewText: options.proposeNewText,
  };
}

/**
 * Offline proposer: deterministically suggests one of a fixed list of variants
 * for the target. Useful in tests and for sweep-style optimisation where the
 * caller provides the candidate texts up front.
 */
export function manualProposer(variants: Record<string, string[]>): GepaProposer {
  const cursors = new Map<string, number>();
  return async ({ target, current }) => {
    const list = variants[target.id] ?? [];
    if (list.length === 0) return current;
    const cursor = cursors.get(target.id) ?? 0;
    const next = list[cursor % list.length] as string;
    cursors.set(target.id, cursor + 1);
    return next;
  };
}
