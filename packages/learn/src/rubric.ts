import type { TaskExample } from './dataset.js';
import type { RolloutTrace } from './rollout.js';
import type { RewardSignal, Rubric, RubricResult } from './rubric-types.js';
import { consecutiveDuplicateToolIndexes } from './tool-trace-analysis.js';

export function antiGamingRubric(options: { id?: string } = {}): Rubric {
  return {
    id: options.id ?? 'anti-gaming',
    evaluate(example, rollout) {
      return weightedAverage([
        toolUseRequiredSignal(example, rollout),
        toolOutcomeSignal(rollout),
        efficiencySignal(example, rollout),
        dummyCallSignal(rollout),
      ]);
    },
  };
}

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

function efficiencySignal(example: TaskExample, rollout: RolloutTrace): RewardSignal {
  const budget = example.maxToolCalls ?? 8;
  const overBudget = rollout.toolCalls.length - budget;
  const score = overBudget <= 0 ? 1 : Math.max(0, 1 - overBudget / Math.max(1, budget));
  return { id: 'efficiency', kind: 'programmatic', weight: 0.1, score };
}

function dummyCallSignal(rollout: RolloutTrace): RewardSignal {
  const duplicatePairs = consecutiveDuplicateToolIndexes(rollout).length;
  const score =
    duplicatePairs === 0
      ? 1
      : Math.max(0, 1 - duplicatePairs / Math.max(1, rollout.toolCalls.length));
  return { id: 'dummy_call_detection', kind: 'programmatic', weight: 0.15, score };
}

function weightedAverage(signals: RewardSignal[]): RubricResult {
  const totalWeight = signals.reduce((sum, signal) => sum + signal.weight, 0);
  const score =
    totalWeight === 0
      ? 0
      : signals.reduce((sum, signal) => sum + signal.score * signal.weight, 0) / totalWeight;
  return { score, signals };
}
