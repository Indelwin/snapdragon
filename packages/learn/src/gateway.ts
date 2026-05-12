import type { LearningDataset } from './dataset.js';
import type { LearnEvalGatewayPayload, LearnJobSpec } from './job-types.js';

export interface LearnGatewayJob<Payload> {
  kind: string;
  payload: Payload;
  queue: string;
  maxAttempts: number;
}

export function learnJobToGatewayJob(job: LearnJobSpec): LearnGatewayJob<LearnJobSpec> {
  return {
    kind: `learn.${job.kind}`,
    payload: job,
    queue: 'learn',
    maxAttempts: 1,
  };
}

export function learnEvalJobToGatewayJob(
  job: LearnJobSpec,
  dataset: LearningDataset,
): LearnGatewayJob<LearnEvalGatewayPayload> {
  return {
    kind: 'learn.eval',
    payload: { job, dataset },
    queue: 'learn',
    maxAttempts: 1,
  };
}
