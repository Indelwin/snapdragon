export interface ContextWindowOptions {
  enabled?: boolean;
  freshTailCount?: number;
  maxRequestTokens?: number;
  chunkTargetTokens?: number;
  summaryTargetTokens?: number;
  minChunkMessages?: number;
  maxCompactionPasses?: number;
}

export interface ResolvedContextWindowOptions {
  enabled: boolean;
  freshTailCount: number;
  maxRequestTokens: number;
  chunkTargetTokens: number;
  summaryTargetTokens: number;
  minChunkMessages: number;
  maxCompactionPasses: number;
}

export const DEFAULT_CONTEXT_WINDOW_OPTIONS: ResolvedContextWindowOptions = {
  enabled: true,
  freshTailCount: 32,
  maxRequestTokens: 120_000,
  chunkTargetTokens: 8_000,
  summaryTargetTokens: 1_500,
  minChunkMessages: 4,
  maxCompactionPasses: 16,
};

export function resolveContextWindowOptions(
  options: ContextWindowOptions = {},
): ResolvedContextWindowOptions {
  return {
    enabled: options.enabled ?? DEFAULT_CONTEXT_WINDOW_OPTIONS.enabled,
    freshTailCount: positiveInteger(
      options.freshTailCount,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.freshTailCount,
    ),
    maxRequestTokens: positiveInteger(
      options.maxRequestTokens,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.maxRequestTokens,
    ),
    chunkTargetTokens: positiveInteger(
      options.chunkTargetTokens,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.chunkTargetTokens,
    ),
    summaryTargetTokens: positiveInteger(
      options.summaryTargetTokens,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.summaryTargetTokens,
    ),
    minChunkMessages: positiveInteger(
      options.minChunkMessages,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.minChunkMessages,
    ),
    maxCompactionPasses: positiveInteger(
      options.maxCompactionPasses,
      DEFAULT_CONTEXT_WINDOW_OPTIONS.maxCompactionPasses,
    ),
  };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
