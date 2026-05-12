import type { LearningDataset, TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';
import type { RubricResult } from './rubric-types.js';
import type {
  Verifier,
  VerifierAggregationMode,
  VerifierResult,
  VerifierSummary,
} from './verifier-types.js';

export type LearningJobKind = 'gepa' | 'sft' | 'rl' | 'eval';

export interface LearningJob {
  id: string;
  kind: LearningJobKind;
  dataset: string;
  model?: string;
  backend?: string;
  maxSteps?: number;
  metadata?: Record<string, unknown>;
}

export interface LearnJobSpec extends LearningJob {
  artifactRoot?: string;
  rubric?: string;
}

export interface LearnEvalGatewayPayload {
  job: LearnJobSpec;
  dataset: LearningDataset;
}

export interface LearningArtifact {
  path: string;
  kind: 'dataset' | 'rollout' | 'metrics' | 'checkpoint' | 'eval' | 'sft' | 'prompt';
  metadata?: Record<string, unknown>;
}

export interface ExampleEvalResult {
  exampleId: string;
  score: number;
  rubric: RubricResult;
  verifierResults?: VerifierResult[];
  verifierSummary?: VerifierSummary;
  rollout: RolloutTrace;
  error?: string;
}

export interface LearningJobResult {
  jobId: string;
  score: number;
  examples: number;
  exampleResults?: ExampleEvalResult[];
  artifacts: LearningArtifact[];
  events: LearnRunEvent[];
}

export interface LearnRunEvent {
  jobId: string;
  type: 'started' | 'progress' | 'checkpoint' | 'completed' | 'failed';
  at: string;
  data?: Record<string, unknown>;
}

export interface EvaluateDatasetOptions {
  verifiers?: Verifier[];
  verifierAggregation?: VerifierAggregationMode;
  failOnVerifierError?: boolean;
  continueOnError?: boolean;
  includeExampleResults?: boolean;
  onEvent?: (event: LearnRunEvent) => void | Promise<void>;
}

export interface TrainingBackend<JobConfig = unknown> {
  id: string;
  createConfig(job: LearningJob, dataset: LearningDataset): JobConfig;
}

export type RolloutRunner = (example: TaskExample) => RolloutTrace | Promise<RolloutTrace>;
