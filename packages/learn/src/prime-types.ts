import type { LearningDataset } from './dataset.js';
import type { LearningArtifact, LearningJob } from './job-types.js';

export interface PrimeEnvironmentRef {
  id: string;
  args?: Record<string, unknown>;
  num_examples?: number;
  rollouts_per_example?: number;
}

export interface PrimeEvalConfig {
  interval?: number;
  num_examples?: number;
  rollouts_per_example?: number;
  eval_base_model?: boolean;
  env?: PrimeEnvironmentRef[];
}

export interface PrimeValidationConfig {
  num_examples?: number;
  rollouts_per_example?: number;
  interval?: number;
}

export interface PrimeBufferConfig {
  online_difficulty_filtering?: boolean;
  easy_threshold?: number;
  hard_threshold?: number;
  easy_fraction?: number;
  hard_fraction?: number;
  env_ratios?: number[];
  seed?: number;
}

export interface PrimeTrainingConfig {
  model?: string;
  max_steps?: number;
  batch_size?: number;
  rollouts_per_example?: number;
  learning_rate?: number;
  lora_alpha?: number;
  oversampling_factor?: number;
  max_async_level?: number;
  trajectory_strategy?: 'interleaved' | 'branching';
  checkpoint_id?: string;
  env_file?: string[];
  sampling?: PrimeSamplingConfig;
  env?: PrimeEnvironmentRef[];
  eval?: PrimeEvalConfig;
  val?: PrimeValidationConfig;
  buffer?: PrimeBufferConfig;
  checkpoints?: PrimeCheckpointConfig;
  adapters?: PrimeAdapterConfig;
  wandb?: PrimeWandbConfig;
  infrastructure?: PrimeInfrastructureConfig;
  metadata?: Record<string, unknown>;
}

export interface PrimeSamplingConfig {
  max_tokens?: number;
  enable_thinking?: boolean;
  reasoning_effort?: 'low' | 'medium' | 'high';
}

export interface PrimeCheckpointConfig {
  interval?: number;
  keep_cloud?: number;
}

export interface PrimeAdapterConfig {
  interval?: number;
  keep_last?: number;
}

export interface PrimeWandbConfig {
  project?: string;
  name?: string;
  entity?: string;
}

export interface PrimeInfrastructureConfig {
  compute_size?: 'S' | 'M' | 'L';
}

export interface CreatePrimeTrainingConfigOptions extends Partial<PrimeTrainingConfig> {
  environmentArgs?: Record<string, unknown>;
  evalEnvironment?: PrimeEnvironmentRef;
}

export type PrimeEvalJobKind = 'local' | 'cli' | 'hosted';
export type PrimeEvalStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface PrimeEvalEndpointRef {
  id?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
}

export interface PrimeEvalRunConfig {
  id?: string;
  kind?: PrimeEvalJobKind;
  env: PrimeEnvironmentRef[];
  endpoint?: PrimeEvalEndpointRef;
  endpoints_path?: string;
  rollouts_per_example?: number;
  num_examples?: number;
  save_results?: boolean;
  seed?: number;
  metadata?: Record<string, unknown>;
}

export interface PrimeHostedEvalSample {
  id?: string;
  input: unknown;
  output?: unknown;
  expected?: unknown;
  metadata?: Record<string, unknown>;
}

export interface PrimeHostedEvalRequest {
  name: string;
  model?: string;
  env?: PrimeEnvironmentRef[];
  samples?: PrimeHostedEvalSample[];
  metadata?: Record<string, unknown>;
}

export interface PrimeEvalRunResult {
  id: string;
  status: PrimeEvalStatus;
  score?: number;
  samples?: PrimeHostedEvalSample[];
  artifacts?: LearningArtifact[];
  metadata?: Record<string, unknown>;
}

export interface CreatePrimeEvalConfigOptions extends Partial<PrimeEvalRunConfig> {
  environmentArgs?: Record<string, unknown>;
  endpoint?: PrimeEvalEndpointRef;
}

export interface PrimeEvalAdapter {
  id: string;
  createEvalConfig(
    job: LearningJob,
    dataset: LearningDataset,
    options?: CreatePrimeEvalConfigOptions,
  ): PrimeEvalRunConfig;
  createHostedEvalRequest?(
    job: LearningJob,
    dataset: LearningDataset,
    samples?: PrimeHostedEvalSample[],
  ): PrimeHostedEvalRequest;
}
