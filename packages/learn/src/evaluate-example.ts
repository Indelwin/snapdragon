// Per-example evaluation helpers extracted from evaluate.ts to keep that
// module under the project's complexity budget. evaluateExample takes one
// task, runs the rollout, applies the rubric + verifiers, and pushes events.

import type { TaskExample } from './dataset.js';
import type {
  EvaluateDatasetOptions,
  ExampleEvalResult,
  LearningJob,
  LearnRunEvent,
  RolloutRunner,
} from './job-types.js';
import type { RolloutTrace } from './rollout.js';
import type { Rubric } from './rubric-types.js';
import { evaluateVerifiers } from './verifier-eval.js';

export interface EvaluateExampleContext {
  job: LearningJob;
  rubric: Rubric;
  rollout: RolloutRunner;
  options: EvaluateDatasetOptions;
  events: LearnRunEvent[];
  scores: number[];
  exampleResults: ExampleEvalResult[];
}

export async function evaluateExample(
  ctx: EvaluateExampleContext,
  example: TaskExample,
): Promise<void> {
  try {
    const trace = await ctx.rollout(example);
    const result = await scoredExample(ctx, example, trace);
    ctx.scores.push(result.score);
    if (shouldRecord(ctx.options)) ctx.exampleResults.push(result);
  } catch (error) {
    await handleExampleError(ctx, example, error);
  }
}

async function scoredExample(
  ctx: EvaluateExampleContext,
  example: TaskExample,
  trace: RolloutTrace,
): Promise<ExampleEvalResult> {
  const rubricResult = await ctx.rubric.evaluate(example, trace);
  const verifierSummary = ctx.options.verifiers
    ? await evaluateVerifiers(
        ctx.options.verifiers,
        example,
        trace,
        ctx.options.verifierAggregation,
      )
    : undefined;
  if (ctx.options.failOnVerifierError && verifierSummary && !verifierSummary.passed) {
    throw new Error(`verifier failure for example ${example.id}`);
  }
  await emitEvent(
    ctx.events,
    runEvent(ctx.job.id, 'progress', { example: example.id, score: rubricResult.score }),
    ctx.options,
  );
  return {
    exampleId: example.id,
    score: rubricResult.score,
    rubric: rubricResult,
    verifierResults: verifierSummary?.results,
    verifierSummary,
    rollout: trace,
  };
}

async function handleExampleError(
  ctx: EvaluateExampleContext,
  example: TaskExample,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await emitEvent(
    ctx.events,
    runEvent(ctx.job.id, 'failed', { example: example.id, error: message }),
    ctx.options,
  );
  if (shouldRecord(ctx.options)) ctx.exampleResults.push(errorResult(example, message));
  if (!ctx.options.continueOnError) throw error;
  ctx.scores.push(0);
}

function errorResult(example: TaskExample, error: string): ExampleEvalResult {
  return {
    exampleId: example.id,
    score: 0,
    rubric: { score: 0, signals: [] },
    rollout: { exampleId: example.id, output: '', toolCalls: [] },
    error,
  };
}

function shouldRecord(options: EvaluateDatasetOptions): boolean {
  return options.includeExampleResults !== false;
}

export async function emitEvent(
  events: LearnRunEvent[],
  event: LearnRunEvent,
  options: EvaluateDatasetOptions,
): Promise<void> {
  events.push(event);
  await options.onEvent?.(event);
}

export function runEvent(
  jobId: string,
  type: LearnRunEvent['type'],
  data?: Record<string, unknown>,
): LearnRunEvent {
  return { jobId, type, at: new Date().toISOString(), data };
}
