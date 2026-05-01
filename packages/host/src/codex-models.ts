import type { ProviderModelLimits } from './provider-types.js';

export const CODEX_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
  'gpt-5.2',
] as const;

export type CodexModelId = (typeof CODEX_MODELS)[number];

export const CODEX_MODEL_LIMITS: Record<CodexModelId, ProviderModelLimits> = {
  'gpt-5.5': {
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    effectiveContextWindowPercent: 95,
  },
  'gpt-5.4': {
    contextWindow: 272_000,
    maxContextWindow: 1_000_000,
    effectiveContextWindowPercent: 95,
  },
  'gpt-5.4-mini': {
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    effectiveContextWindowPercent: 95,
  },
  'gpt-5.3-codex': {
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    effectiveContextWindowPercent: 95,
  },
  'gpt-5.3-codex-spark': {
    contextWindow: 128_000,
    maxContextWindow: 128_000,
    effectiveContextWindowPercent: 95,
  },
  'gpt-5.2': {
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    effectiveContextWindowPercent: 95,
  },
};

export function codexModelLimits(model: string): ProviderModelLimits | undefined {
  return CODEX_MODEL_LIMITS[model as CodexModelId];
}
