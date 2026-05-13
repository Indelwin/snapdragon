// GEPA optimiser entry point.
//
// `optimizeGepa(...)` runs a Pareto-front-driven prompt/skill/target search:
//
//   1. Evaluate the seed candidate on a minibatch from the TaskSource.
//   2. Until budget or early-stop hits:
//        a. Sample a parent from the current Pareto front.
//        b. Pick one target to edit (round-robin for now).
//        c. Ask the adapter to evaluate the parent on a fresh minibatch
//           (this gives reflective evidence: trace + rubric per task).
//        d. Ask the adapter to propose new text for the target.
//        e. Validate; build a child candidate; evaluate it on the same batch.
//        f. Accept (add to history + Pareto re-computation) if the child
//           improves on the parent's batch mean by at least `minImprovement`.
//   3. Return the best candidate, Pareto front, and full event log.
//
// Merge/crossover and feedback-memory rollups (the "GEPA-Merge" line in the
// ax-llm reference) are intentionally deferred — this commit lands the
// mutation-only core.

import type { GepaAdapter } from './gepa-adapter.js';
import {
  drawMinibatch,
  emit,
  evaluateCandidate,
  type LoopContext,
  nowIso,
  pickTarget,
  proposeChild,
} from './gepa-loop.js';
import { paretoFront, seededRng, selectParent } from './gepa-selection.js';
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
  const parent = selectParent(front, { rng: ctx.rng });
  const target = pickTarget(ctx, iteration - 1);
  const minibatch = await drawMinibatch(ctx, minibatchSize);
  const feedback = await ctx.adapter.evaluate({
    candidate: parent,
    targets: ctx.targets,
    tasks: minibatch,
    signal: ctx.options.signal,
  });
  ctx.evals.count += 1;
  const parentBatchMean = average(feedback.scores);
  const child = await proposeChild(ctx, parent, target, feedback, iteration);
  if (child.error) {
    await emit(ctx, {
      type: 'rejected',
      at: nowIso(),
      candidateId: child.candidate.id,
      reason: child.error,
    });
    return false;
  }
  await evaluateCandidate(ctx, child.candidate, minibatch);
  const accepted = child.candidate.meanScore >= parentBatchMean + minImprovement;
  if (accepted) history.push(child.candidate);
  await emit(ctx, {
    type: 'candidate',
    at: nowIso(),
    candidateId: child.candidate.id,
    parentId: parent.id,
    target: target.id,
    minibatchScore: child.candidate.meanScore,
    accepted,
  });
  await emit(ctx, {
    type: 'iteration',
    at: nowIso(),
    iteration,
    bestScore: pickBest(history).meanScore,
    paretoSize: paretoFront(history).length,
  });
  return accepted;
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
  };
}

function buildSeed(ctx: LoopContext, args: OptimizeGepaArgs): GepaCandidate {
  return {
    id: args.seed.id ?? ctx.nextId(),
    components: { ...args.seed.components },
    scores: [],
    meanScore: Number.NaN,
    generation: 0,
  };
}

function pickBest(history: readonly GepaCandidate[]): GepaCandidate {
  return history.reduce((best, candidate) =>
    candidate.meanScore > best.meanScore ? candidate : best,
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
