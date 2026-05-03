export interface AnthropicPromptCachingOptions {
  enabled?: boolean;
  ttl?: '5m' | '1h';
  automatic?: boolean;
  cacheTools?: boolean;
  cacheSystem?: boolean;
  cacheMessages?: boolean;
}

export interface NormalizedAnthropicPromptCachingOptions {
  enabled: boolean;
  ttl?: '5m' | '1h';
  automatic: boolean;
  cacheTools: boolean;
  cacheSystem: boolean;
  cacheMessages: boolean;
}

export type AnthropicPromptCachingInput = boolean | AnthropicPromptCachingOptions | undefined;

export interface AnthropicBodyOptions {
  model: string;
  defaultMaxTokens?: number;
  promptCaching?: AnthropicPromptCachingInput;
}
