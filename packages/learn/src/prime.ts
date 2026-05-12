import type { LearningDataset } from './dataset.js';
import type { LearningJob, TrainingBackend } from './job-types.js';
import type {
  CreatePrimeTrainingConfigOptions,
  PrimeEnvironmentRef,
  PrimeTrainingConfig,
} from './prime-types.js';

export const primeBackend: TrainingBackend<PrimeTrainingConfig> = {
  id: 'prime-intellect',
  createConfig(job, dataset) {
    return createPrimeTrainingConfig(job, dataset);
  },
};

export function createPrimeTrainingConfig(
  job: LearningJob,
  dataset: LearningDataset,
  options: CreatePrimeTrainingConfigOptions = {},
): PrimeTrainingConfig {
  const env = options.env ?? [primeEnvironmentRefForDataset(job, dataset, options.environmentArgs)];
  const config: PrimeTrainingConfig = {
    model: job.model,
    max_steps: job.maxSteps,
    env,
    eval: { interval: 100, eval_base_model: true, ...options.eval },
    buffer: { online_difficulty_filtering: true, ...options.buffer },
    ...withoutPrimeOptionAliases(options),
  };
  if (options.evalEnvironment) {
    config.eval = { ...config.eval, env: [options.evalEnvironment] };
  }
  return stripUndefined(config);
}

function primeEnvironmentRefForDataset(
  job: LearningJob,
  dataset: LearningDataset,
  environmentArgs?: Record<string, unknown>,
): PrimeEnvironmentRef {
  const primeEnvironment = dataset.environments?.find(
    (environment) => environment.kind === 'prime',
  );
  return {
    id: primeEnvironment?.id ?? job.dataset,
    args: environmentArgs ?? primeEnvironment?.args,
  };
}

function withoutPrimeOptionAliases(
  options: CreatePrimeTrainingConfigOptions,
): Partial<PrimeTrainingConfig> {
  const {
    environmentArgs: _environmentArgs,
    evalEnvironment: _evalEnvironment,
    ...config
  } = options;
  return config;
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(stripUndefined).filter((entry) => entry !== undefined) as T;
  }
  if (value && typeof value === 'object') return stripUndefinedObject(value);
  return value;
}

function stripUndefinedObject<T>(value: T): T {
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .map(([key, entry]) => [key, stripUndefined(entry)]);
  return Object.fromEntries(entries) as T;
}
