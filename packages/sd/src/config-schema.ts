import type { ReasoningRequest } from '@snapdragon-ai/host';
import type { SdAgentConfig } from './agent-config-types.js';
import type {
  SdBackgroundConfig,
  SdGatewayConfig,
  SdIsolationConfig,
} from './config-runtime-types.js';
import type { SdSessionIndexConfig } from './config-session-index.js';
import type { SdTuiConfig } from './tui-config.js';

export type SdProviderKind =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'mock'
  | 'openai-codex'
  | 'extension';

export interface SdProviderConfig {
  kind?: SdProviderKind;
  api_key_env?: string;
  model?: string;
  default_model?: string;
  models?: string[];
  base_url?: string;
  codex_auth_path?: string;
  extra_headers?: Record<string, string>;
  organization_env?: string;
  reasoning?: ReasoningRequest;
  extension?: string;
}

export interface SdToolsetsConfig {
  enabled?: string[];
  disabled?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
}

export interface SdSkillsConfig {
  root?: string;
  shared_roots?: string[];
  compatibility_roots?: string[];
  enabled?: string[];
  disabled?: string[];
  authoring?: boolean;
  builtins?: boolean;
  builder?: SdSkillBuilderConfig;
}

export interface SdSkillBuilderConfig {
  enabled?: boolean;
  interval_ms?: number;
  startup_delay_ms?: number;
  lookback_sessions?: number;
  min_pattern_count?: number;
  min_distinct_sessions?: number;
  min_pattern_count_for_draft?: number;
  max_drafts_per_pass?: number;
  draft_max_tokens?: number;
  similarity_top_k?: number;
  exclude_leading_tools?: string[];
  collapse_subsumed?: boolean;
}

export interface SdMemoryAutoConfig {
  enabled?: boolean;
  triggers?: string[];
  max_entry_chars?: number;
  include_assistant?: boolean;
}

export interface SdMemoryWorkerConfig {
  enabled?: boolean;
  interval_ms?: number;
  lookback_sessions?: number;
  include_assistant?: boolean;
}

export interface SdMemoryConfig {
  enabled?: boolean;
  provider?: string;
  root?: string;
  file?: string;
  authoring?: boolean;
  auto?: SdMemoryAutoConfig;
  context?: {
    enabled?: boolean;
    max_entries?: number;
  };
  worker?: SdMemoryWorkerConfig;
}

export interface SdExtensionsConfig {
  roots?: string[];
  enabled?: string[];
  disabled?: string[];
  hot_reload?: boolean;
  builtins?: boolean;
}

export interface SdSessionTitleConfig {
  enabled?: boolean;
  provider?: string;
  model?: string;
  max_tokens?: number;
}

export interface SdSessionConfig {
  enabled?: boolean;
  root?: string;
  title?: SdSessionTitleConfig;
  index?: SdSessionIndexConfig;
}

export interface SdTodoConfig {
  enabled?: boolean;
  file?: string;
}

export interface SdWebtoolsConfig {
  enabled?: boolean;
  default_user_agent?: string;
  default_timeout_ms?: number;
}

export interface SdConfig {
  version: 1;
  default_provider: string;
  providers: Record<string, SdProviderConfig>;
  sessions?: SdSessionConfig;
  todo?: SdTodoConfig;
  webtools?: SdWebtoolsConfig;
  skills?: SdSkillsConfig;
  memory?: SdMemoryConfig;
  extensions?: SdExtensionsConfig;
  gateway?: SdGatewayConfig;
  background?: SdBackgroundConfig;
  isolation?: SdIsolationConfig;
  toolsets?: SdToolsetsConfig;
  agent?: SdAgentConfig;
  tui?: SdTuiConfig;
}
