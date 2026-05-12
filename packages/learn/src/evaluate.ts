import type { TaskExample } from './dataset.js';
import type {
  EvaluateDatasetOptions,
  ExampleEvalResult,
  LearningJob,
  LearningJobResult,
  LearnRunEvent,
  RolloutRunner,
} from './job-types.js';
import type { RolloutTrace } from './rollout.js';
import type { Rubric } from './rubric-types.js';
import { evaluateVerifiers } from './verifier-eval.js';

export async function evaluateDataset(
  job: LearningJob,
  dataset: { examples: TaskExample[] },
  rubric: Rubric,
  rollout: RolloutRunner,
  options: EvaluateDatasetOptions = {},
): Promise<LearningJobResult> {
  const events: LearnRunEvent[] = [];
  await emitEvent(events, runEvent(job.id, 'started'), options);

  const scores: number[] = [];
  const exampleResults: ExampleEvalResult[] = [];
  for (const example of dataset.examples) {
    await evaluateExample(job, example, rubric, rollout, options, events, scores, exampleResults);
  }

  const score = average(scores);
  await emitEvent(events, runEvent(job.id, 'completed', { score }), options);
  return {
    jobId: job.id,
    score,
    examples: dataset.examples.length,
    exampleResults: options.includeExampleResults === false ? undefined : exampleResults,
    artifacts: [],
    events,
  };
}

async function evaluateExample(
  job: LearningJob,
  example: TaskExample,
  rubric: Rubric,
  rollout: RolloutRunner,
  options: EvaluateDatasetOptions,
  events: LearnRunEvent[],
  scores: number[],
  exampleResults: ExampleEvalResult[],
): Promise<void> {
  try {
    const trace = await rollout(example);
    const result = await scoredExample(job, example, rubric, trace, options, events);
    scores.push(result.score);
    if (options.includeExampleResults ?? true) exampleResults.push(result);
  } catch (error) {
    await handleExampleError(job, example, error, options, events, scores, exampleResults);
  }
}

async function scoredExample(
  job: LearningJob,
  example: TaskExample,
  rubric: Rubric,
  trace: RolloutTrace,
  options: EvaluateDatasetOptions,
  events: LearnRunEvent[],
): Promise<ExampleEvalResult> {
  const rubricResult = await rubric.evaluate(example, trace);
  const verifierSummary = options.verifiers
    ? await evaluateVerifiers(options.verifiers, example, trace, options.verifierAggregation)
    : undefined;
  if (options.failOnVerifierError && verifierSummary && !verifierSummary.passed) {
    throw new Error(`verifier failure for example ${example.id}`);
  }
  await emitEvent(
    events,
    runEvent(job.id, 'progress', { example: example.id, score: rubricResult.score }),
    options,
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
  job: LearningJob,
  example: TaskExample,
  error: unknown,
  options: EvaluateDatasetOptions,
  events: LearnRunEvent[],
  scores: number[],
  exampleResults: ExampleEvalResult[],
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await emitEvent(
    events,
    runEvent(job.id, 'failed', { example: example.id, error: message }),
    options,
  );
  if (options.includeExampleResults ?? true) exampleResults.push(errorResult(example, message));
  if (!options.continueOnError) throw error;
  scores.push(0);
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

async function emitEvent(
  events: LearnRunEvent[],
  event: LearnRunEvent,
  options: EvaluateDatasetOptions,
): Promise<void> {
  events.push(event);
  await options.onEvent?.(event);
}

function runEvent(
  jobId: string,
  type: LearnRunEvent['type'],
  data?: Record<string, unknown>,
): LearnRunEvent {
  return { jobId, type, at: new Date().toISOString(), data };
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
