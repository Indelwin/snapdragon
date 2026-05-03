import type { SdConfig } from './config.js';

type ContextConfig = NonNullable<NonNullable<SdConfig['agent']>['context']>;

export function contextSnapshot(context: Partial<ContextConfig>, derivedMax: number | undefined) {
  return {
    enabled: context.enabled,
    freshTailCount: context.fresh_tail_count,
    maxRequestTokens: context.max_request_tokens ?? derivedMax,
    chunkTargetTokens: context.chunk_target_tokens,
    summaryTargetTokens: context.summary_target_tokens,
    minChunkMessages: context.min_chunk_messages,
    maxCompactionPasses: context.max_compaction_passes,
  };
}
