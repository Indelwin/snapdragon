// Mutation and merge iteration helpers for `optimizeGepa`. Extracted so the
// main entry point stays under the complexity/length budget.

import type { TaskExample } from './dataset.js';
import {
  buildChildFromComponents,
  emit,
  evaluateCandidate,
  type LoopContext,
  nowIso,
  pickTarget,
  proposeChild,
} from './gepa-loop.js';
import { buildMergeChild, pickMergePair } from './gepa-merge.js';
import { paretoFront, selectParent } from './gepa-selection.js';
import type { GepaCandidate } from './gepa-types.js';

export async function runMutationIteration(
  ctx: LoopContext,
  history: GepaCandidate[],
  front: readonly GepaCandidate[],
  minibatch: readonly TaskExample[],
  iteration: number,
  minImprovement: number,
): Promise<boolean> {
  const parent = selectParent(front, { rng: ctx.rng });
  const target = pickTarget(ctx, iteration - 1);
  const feedback = await ctx.adapter.evaluate({
    candidate: parent,
    targets: ctx.targets,
    tasks: minibatch,
    signal: ctx.options.signal,
  });
  ctx.evals.count += 1;
  ctx.memory.record(target.id, feedback.data);
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
  await emitIteration(ctx, history, iteration);
  return accepted;
}

export async function tryMergeIteration(
  ctx: LoopContext,
  history: GepaCandidate[],
  front: readonly GepaCandidate[],
  minibatch: readonly TaskExample[],
  iteration: number,
  minImprovement: number,
): Promise<boolean | 'fallback'> {
  const pair = pickMergePair(front, ctx.rng);
  if (!pair) return 'fallback';
  const proposal = buildMergeChild({ parentA: pair[0], parentB: pair[1], rng: ctx.rng });
  if (!proposal) return 'fallback';
  const child = buildChildFromComponents(
    ctx,
    proposal.components,
    [pair[0].id, pair[1].id],
    iteration,
  );
  await evaluateCandidate(ctx, child, minibatch);
  const baseline = Math.max(pair[0].meanScore, pair[1].meanScore);
  const accepted = child.meanScore >= baseline + minImprovement;
  if (accepted) history.push(child);
  await emit(ctx, {
    type: 'merge',
    at: nowIso(),
    candidateId: child.id,
    parentIds: [pair[0].id, pair[1].id],
    mergedTargets: proposal.mergedTargets,
    minibatchScore: child.meanScore,
    accepted,
  });
  await emitIteration(ctx, history, iteration);
  return accepted;
}

export async function emitIteration(
  ctx: LoopContext,
  history: readonly GepaCandidate[],
  iteration: number,
): Promise<void> {
  await emit(ctx, {
    type: 'iteration',
    at: nowIso(),
    iteration,
    bestScore: pickBest(history).meanScore,
    paretoSize: paretoFront(history).length,
  });
}

export function pickBest(history: readonly GepaCandidate[]): GepaCandidate {
  return history.reduce((best, candidate) =>
    candidate.meanScore > best.meanScore ? candidate : best,
  );
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
