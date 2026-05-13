import type { TaskExample } from './dataset.js';
import {
  type EvaluateExampleContext,
  emitEvent,
  evaluateExample,
  runEvent,
} from './evaluate-example.js';
import type {
  EvaluateDatasetOptions,
  ExampleEvalResult,
  LearningJob,
  LearningJobResult,
  LearnRunEvent,
  RolloutRunner,
} from './job-types.js';
import type { Rubric } from './rubric-types.js';
import type { TaskSource } from './task-source.js';
import { datasetTaskSource } from './task-source-dataset.js';

export interface EvaluateSourceOptions extends EvaluateDatasetOptions {
  /**
   * How many tasks to draw from the source. Required when source.size is
   * undefined; otherwise defaults to source.size.
   */
  count?: number;
  seed?: number;
  signal?: AbortSignal;
}

/**
 * Evaluate a TaskSource (the general path). Datasets, process sandboxes,
 * HTTP gym envs, procedural generators, and mixed sources all flow through
 * here.
 */
export async function evaluateSource(
  job: LearningJob,
  source: TaskSource,
  rubric: Rubric,
  rollout: RolloutRunner,
  options: EvaluateSourceOptions = {},
): Promise<LearningJobResult> {
  const count = resolveCount(source, options);
  const events: LearnRunEvent[] = [];
  await emitEvent(events, runEvent(job.id, 'started'), options);

  const scores: number[] = [];
  const exampleResults: ExampleEvalResult[] = [];
  const ctx: EvaluateExampleContext = {
    job,
    rubric,
    rollout,
    options,
    events,
    scores,
    exampleResults,
  };
  const processed = await drainSource(source, ctx, count, options);

  const score = average(scores);
  await emitEvent(events, runEvent(job.id, 'completed', { score }), options);
  return {
    jobId: job.id,
    score,
    examples: processed,
    exampleResults: options.includeExampleResults === false ? undefined : exampleResults,
    artifacts: [],
    events,
  };
}

/** Backward-compatible dataset wrapper around evaluateSource. */
export async function evaluateDataset(
  job: LearningJob,
  dataset: { id?: string; examples: TaskExample[] },
  rubric: Rubric,
  rollout: RolloutRunner,
  options: EvaluateDatasetOptions = {},
): Promise<LearningJobResult> {
  const source = datasetTaskSource({
    id: dataset.id ?? job.dataset,
    examples: dataset.examples,
  });
  return evaluateSource(job, source, rubric, rollout, {
    ...options,
    count: dataset.examples.length,
  });
}

async function drainSource(
  source: TaskSource,
  ctx: EvaluateExampleContext,
  count: number,
  options: EvaluateSourceOptions,
): Promise<number> {
  let processed = 0;
  for await (const example of source.sample({
    count,
    seed: options.seed,
    signal: options.signal,
  })) {
    if (options.signal?.aborted) break;
    await evaluateExample(ctx, example);
    processed += 1;
    if (processed >= count) break;
  }
  return processed;
}

function resolveCount(source: TaskSource, options: EvaluateSourceOptions): number {
  if (typeof options.count === 'number') return options.count;
  if (typeof source.size === 'number') return source.size;
  throw new Error(
    `evaluateSource(${source.id}): source is streaming (size=undefined); options.count is required`,
  );
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
