export type LearningJobKind = 'gepa' | 'sft' | 'rl' | 'eval';
export type RewardSignalKind = 'programmatic' | 'judge' | 'metric';

export interface TaskExample {
  id: string;
  prompt: string;
  category?: string;
  requiresTools?: boolean;
  metadata?: Record<string, unknown>;
}

export interface LearningDataset {
  id: string;
  examples: TaskExample[];
  metadata?: Record<string, unknown>;
}

export interface ToolTraceStep {
  name: string;
  success: boolean;
  durationMs?: number;
}

export interface RolloutTrace {
  exampleId: string;
  output: string;
  toolCalls: ToolTraceStep[];
  metadata?: Record<string, unknown>;
}

export interface RewardSignal {
  id: string;
  kind: RewardSignalKind;
  weight: number;
  score: number;
  reason?: string;
}

export interface RubricResult {
  score: number;
  signals: RewardSignal[];
}

export interface Rubric {
  id: string;
  evaluate(example: TaskExample, rollout: RolloutTrace): RubricResult | Promise<RubricResult>;
}

export interface LearningJob {
  id: string;
  kind: LearningJobKind;
  dataset: string;
  model?: string;
  backend?: string;
  maxSteps?: number;
  metadata?: Record<string, unknown>;
}

export interface LearnRunEvent {
  jobId: string;
  type: 'started' | 'progress' | 'checkpoint' | 'completed' | 'failed';
  at: string;
  data?: Record<string, unknown>;
}

export interface TrainingBackend<JobConfig = unknown> {
  id: string;
  createConfig(job: LearningJob, dataset: LearningDataset): JobConfig;
}

export interface PrimeTrainingConfig {
  model?: string;
  max_steps?: number;
  env?: Array<{ id: string; args?: Record<string, unknown> }>;
  eval?: {
    interval?: number;
    eval_base_model?: boolean;
  };
  buffer?: {
    online_difficulty_filtering?: boolean;
  };
}

export function antiGamingRubric(options: { id?: string } = {}): Rubric {
  return {
    id: options.id ?? 'anti-gaming',
    evaluate(example, rollout) {
      const signals = [
        toolUseRequiredSignal(example, rollout),
        toolOutcomeSignal(rollout),
        efficiencySignal(rollout),
        dummyCallSignal(rollout),
      ];
      return weightedAverage(signals);
    },
  };
}

export const primeBackend: TrainingBackend<PrimeTrainingConfig> = {
  id: 'prime-intellect',
  createConfig(job) {
    return {
      model: job.model,
      max_steps: job.maxSteps,
      env: [{ id: job.dataset }],
      eval: { interval: 100, eval_base_model: true },
      buffer: { online_difficulty_filtering: true },
    };
  },
};

function toolUseRequiredSignal(example: TaskExample, rollout: RolloutTrace): RewardSignal {
  const ok = !example.requiresTools || rollout.toolCalls.length > 0;
  return {
    id: 'tool_use_required',
    kind: 'programmatic',
    weight: 0.2,
    score: ok ? 1 : 0,
    reason: ok ? undefined : 'example requires tools but rollout used none',
  };
}

function toolOutcomeSignal(rollout: RolloutTrace): RewardSignal {
  if (rollout.toolCalls.length === 0) {
    return { id: 'tool_outcomes', kind: 'programmatic', weight: 0.2, score: 1 };
  }
  const successes = rollout.toolCalls.filter((call) => call.success).length;
  return {
    id: 'tool_outcomes',
    kind: 'programmatic',
    weight: 0.2,
    score: successes / rollout.toolCalls.length,
  };
}

function efficiencySignal(rollout: RolloutTrace): RewardSignal {
  const score =
    rollout.toolCalls.length <= 8 ? 1 : Math.max(0, 1 - (rollout.toolCalls.length - 8) / 8);
  return { id: 'efficiency', kind: 'programmatic', weight: 0.1, score };
}

function dummyCallSignal(rollout: RolloutTrace): RewardSignal {
  const names = rollout.toolCalls.map((call) => call.name);
  const duplicatePairs = names.filter((name, index) => names[index - 1] === name).length;
  return {
    id: 'dummy_call_detection',
    kind: 'programmatic',
    weight: 0.15,
    score: duplicatePairs === 0 ? 1 : Math.max(0, 1 - duplicatePairs / Math.max(1, names.length)),
  };
}

function weightedAverage(signals: RewardSignal[]): RubricResult {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score =
    totalWeight === 0
      ? 0
      : signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight;
  return { score, signals };
}
