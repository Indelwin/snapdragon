// Inner-loop helpers for `optimizeGepa`. Kept separate from the public entry
// point so each file stays under the project's complexity budget.

import type { TaskExample } from './dataset.js';
import type { GepaAdapter, GepaEvaluateResult } from './gepa-adapter.js';
import type { GepaFeedbackMemory } from './gepa-memory.js';
import type { GepaTarget } from './gepa-target.js';
import { validateTargetValue } from './gepa-target.js';
import type { GepaCandidate, GepaEvent, GepaOptions } from './gepa-types.js';
import type { TaskSource } from './task-source.js';

export interface LoopContext {
  targets: readonly GepaTarget[];
  adapter: GepaAdapter;
  source: TaskSource;
  options: GepaOptions;
  events: GepaEvent[];
  rng: () => number;
  nextId: () => string;
  evals: { count: number };
  memory: GepaFeedbackMemory;
}

export async function evaluateCandidate(
  ctx: LoopContext,
  candidate: GepaCandidate,
  tasks: readonly TaskExample[],
): Promise<GepaEvaluateResult> {
  const result = await ctx.adapter.evaluate({
    candidate,
    targets: ctx.targets,
    tasks,
    signal: ctx.options.signal,
  });
  candidate.scores = result.scores;
  candidate.meanScore = mean(result.scores);
  ctx.evals.count += 1;
  return result;
}

export async function drawMinibatch(ctx: LoopContext, size: number): Promise<TaskExample[]> {
  const tasks: TaskExample[] = [];
  for await (const example of ctx.source.sample({
    count: size,
    seed: ctx.options.seed,
    signal: ctx.options.signal,
  })) {
    tasks.push(example);
    if (tasks.length >= size) break;
  }
  return tasks;
}

export function pickTarget(ctx: LoopContext, iteration: number): GepaTarget {
  const index = iteration % ctx.targets.length;
  return ctx.targets[index] as GepaTarget;
}

export async function proposeChild(
  ctx: LoopContext,
  parent: GepaCandidate,
  target: GepaTarget,
  feedback: GepaEvaluateResult,
  generation: number,
): Promise<{ candidate: GepaCandidate; error?: string }> {
  const current = parent.components[target.id] ?? target.current;
  const proposed = await ctx.adapter.proposeNewText({
    target,
    current,
    feedback: feedback.data,
    memory: ctx.memory.summarize(target.id),
    signal: ctx.options.signal,
  });
  const validation = validateTargetValue(target, proposed);
  if (validation !== true) {
    return {
      candidate: emptyChild(ctx, parent, target, current, generation),
      error: validation,
    };
  }
  const components = { ...parent.components, [target.id]: proposed };
  return {
    candidate: {
      id: ctx.nextId(),
      components,
      scores: [],
      meanScore: Number.NaN,
      generation,
      parents: [parent.id],
      editedTarget: target.id,
    },
  };
}

function emptyChild(
  ctx: LoopContext,
  parent: GepaCandidate,
  target: GepaTarget,
  current: string,
  generation: number,
): GepaCandidate {
  return {
    id: ctx.nextId(),
    components: { ...parent.components, [target.id]: current },
    scores: [],
    meanScore: Number.NaN,
    generation,
    parents: [parent.id],
    editedTarget: target.id,
  };
}

export function buildChildFromComponents(
  ctx: LoopContext,
  components: Record<string, string>,
  parents: readonly string[],
  generation: number,
): GepaCandidate {
  return {
    id: ctx.nextId(),
    components: { ...components },
    scores: [],
    meanScore: Number.NaN,
    generation,
    parents,
  };
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function emit(ctx: LoopContext, event: GepaEvent): Promise<void> {
  ctx.events.push(event);
  await ctx.options.onEvent?.(event);
}

export function nowIso(): string {
  return new Date().toISOString();
}
