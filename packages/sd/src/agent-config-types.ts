import type { ReasoningRequest } from '@snapdragon-ai/host';

export interface SdAgentContextConfig {
  enabled?: boolean;
  fresh_tail_count?: number;
  max_request_tokens?: number;
  chunk_target_tokens?: number;
  summary_target_tokens?: number;
  min_chunk_messages?: number;
  max_compaction_passes?: number;
}

export interface SdAgentConfig {
  max_turns?: number;
  max_tool_result_bytes?: number;
  context?: SdAgentContextConfig;
  temperature?: number;
  max_tokens?: number;
  reasoning?: ReasoningRequest;
}
