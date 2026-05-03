export interface AgentContextOptions {
  enabled?: boolean;
  freshTailCount?: number;
  maxRequestTokens?: number;
  chunkTargetTokens?: number;
  summaryTargetTokens?: number;
  minChunkMessages?: number;
  maxCompactionPasses?: number;
}
