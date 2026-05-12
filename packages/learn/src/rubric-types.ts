import type { TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';

export type RewardSignalKind = 'programmatic' | 'judge' | 'metric';

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
