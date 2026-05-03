import type { SdConfig } from './config.js';

export function contextOptions(config: SdConfig) {
  const context = config.agent?.context;
  if (!context) return undefined;
  return {
    enabled: context.enabled,
    freshTailCount: context.fresh_tail_count,
    maxRequestTokens: context.max_request_tokens,
    chunkTargetTokens: context.chunk_target_tokens,
    summaryTargetTokens: context.summary_target_tokens,
    minChunkMessages: context.min_chunk_messages,
    maxCompactionPasses: context.max_compaction_passes,
  };
}
