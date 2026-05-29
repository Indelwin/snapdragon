// GEPA optimiser entry point.
//
// `optimizeGepa(...)` runs a Pareto-front-driven prompt/skill/target search:
//
//   1. Evaluate the seed candidate on a minibatch from the TaskSource.
//   2. Until budget or early-stop hits, each iteration either:
//        Mutation step (default):
//          a. Sample a parent from the current Pareto front.
//          b. Pick one target to edit (round-robin for now).
//          c. Ask the adapter to evaluate the parent on a fresh minibatch
//             (gives reflective evidence: trace + rubric per task).
//          d. Record the evidence into per-target feedback memory.
//          e. Ask the adapter to propose new text for the target, passing
//             both the current batch's evidence and the cumulative memory.
//          f. Validate; build a child; evaluate on the same batch.
//          g. Accept if child >= parent batch mean + minImprovement.
//        Merge step (with probability `mergeProbability`):
//          a. Pick two distinct Pareto parents.
//          b. Find target ids where their components differ; pick from
//             {a, b} per disjoint target.
//          c. Evaluate child; accept on improvement over the better parent.
//          d. Falls back to mutation when no merge pair is available.
//   3. Return the best candidate, Pareto front, and full event log.

import type { GepaAdapter } from './gepa-adapter.js';
import { pickBest, runMutationIteration, tryMergeIteration } from './gepa-iterations.js';
import { drawMinibatch, emit, evaluateCandidate, type LoopContext, nowIso } from './gepa-loop.js';
import { gepaFeedbackMemory } from './gepa-memory.js';
import { paretoFront, seededRng } from './gepa-selection.js';
import type { GepaTarget } from './gepa-target.js';
import type { GepaCandidate, GepaEvent, GepaOptions, GepaReport } from './gepa-types.js';
import type { TaskSource } from './task-source.js';

export interface OptimizeGepaArgs {
  /** Initial component texts. Seed scores start empty. */
  seed: Pick<GepaCandidate, 'components'> & Partial<GepaCandidate>;
  targets: readonly GepaTarget[];
  adapter: GepaAdapter;
  source: TaskSource;
  options: GepaOptions;
}

export async function optimizeGepa(args: OptimizeGepaArgs): Promise<GepaReport> {
  const ctx = buildContext(args);
  const minibatchSize = args.options.minibatchSize ?? 5;
  const history: GepaCandidate[] = [];

  const seed = buildSeed(ctx, args);
  const seedBatch = await drawMinibatch(ctx, minibatchSize);
  await evaluateCandidate(ctx, seed, seedBatch);
  history.push(seed);
  await emit(ctx, { type: 'started', at: nowIso(), seedScore: seed.meanScore });

  const result = await runLoop(ctx, history, minibatchSize);

  const best = pickBest(history);
  await emit(ctx, {
    type: 'completed',
    at: nowIso(),
    bestScore: best.meanScore,
    iterations: result.iterations,
    evals: ctx.evals.count,
  });
  return {
    best,
    paretoFront: paretoFront(history),
    history,
    iterations: result.iterations,
    evals: ctx.evals.count,
    improved: best.id !== seed.id,
    events: ctx.events,
  };
}

interface LoopResult {
  iterations: number;
}

async function runLoop(
  ctx: LoopContext,
  history: GepaCandidate[],
  minibatchSize: number,
): Promise<LoopResult> {
  const patience = ctx.options.earlyStoppingPatience ?? Number.POSITIVE_INFINITY;
  const minImprovement = ctx.options.minImprovement ?? 0;
  let stagnation = 0;
  let iteration = 0;
  while (iteration < ctx.options.maxIterations) {
    if (ctx.options.signal?.aborted) break;
    if (stagnation >= patience) break;
    iteration += 1;
    const accepted = await runIteration(ctx, history, minibatchSize, iteration, minImprovement);
    stagnation = accepted ? 0 : stagnation + 1;
  }
  return { iterations: iteration };
}

async function runIteration(
  ctx: LoopContext,
  history: GepaCandidate[],
  minibatchSize: number,
  iteration: number,
  minImprovement: number,
): Promise<boolean> {
  const front = paretoFront(history);
  const minibatch = await drawMinibatch(ctx, minibatchSize);
  if (shouldMerge(ctx) && front.length >= 2) {
    const merged = await tryMergeIteration(
      ctx,
      history,
      front,
      minibatch,
      iteration,
      minImprovement,
    );
    if (merged !== 'fallback') return merged;
  }
  return runMutationIteration(ctx, history, front, minibatch, iteration, minImprovement);
}

function shouldMerge(ctx: LoopContext): boolean {
  const probability = ctx.options.mergeProbability ?? 0;
  if (probability <= 0) return false;
  return ctx.rng() < probability;
}

function buildContext(args: OptimizeGepaArgs): LoopContext {
  const rng = args.options.seed != null ? seededRng(args.options.seed) : Math.random;
  let counter = 0;
  const nextId = () => `cand-${++counter}`;
  return {
    targets: args.targets,
    adapter: args.adapter,
    source: args.source,
    options: args.options,
    events: [] as GepaEvent[],
    rng,
    nextId,
    evals: { count: 0 },
    memory: gepaFeedbackMemory({ topK: args.options.memoryTopK }),
    batchSeq: { value: 0 },
  };
}

function buildSeed(ctx: LoopContext, args: OptimizeGepaArgs): GepaCandidate {
  return {
    id: args.seed.id ?? ctx.nextId(),
    components: { ...args.seed.components },
    scores: [],
    scoresByTask: {},
    meanScore: Number.NaN,
    generation: 0,
  };
}
