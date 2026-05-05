import { CODEX_MODELS } from '@snapdragon-ai/host';
import {
  DEFAULT_SD_DAEMON_ROOT,
  DEFAULT_SD_EXTENSION_ROOT,
  DEFAULT_SD_MEMORY_ROOT,
  DEFAULT_SD_SESSION_ROOT,
  DEFAULT_SD_SESSION_TITLE_MODEL,
  DEFAULT_SD_SESSION_TITLE_PROVIDER,
  DEFAULT_SD_TODO_PATH,
} from './config-constants.js';
import type { SdConfig, SdMemoryConfig, SdProviderConfig } from './config-schema.js';
import { defaultSessionIndexConfig } from './config-session-index.js';

function defaultProviders(): Record<string, SdProviderConfig> {
  return {
    anthropic: {
      kind: 'anthropic',
      api_key_env: 'ANTHROPIC_API_KEY',
      model: 'claude-opus-4-7',
    },
    openai: {
      kind: 'openai',
      api_key_env: 'OPENAI_API_KEY',
      model: 'gpt-4o-mini',
    },
    'openai-compatible': {
      kind: 'openai-compatible',
      api_key_env: 'OPENAI_API_KEY',
      base_url: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    },
    mock: { kind: 'mock', model: 'mock' },
    'openai-codex': {
      kind: 'openai-codex',
      model: 'gpt-5.5',
      models: [...CODEX_MODELS],
    },
  };
}

function defaultMemory(): SdMemoryConfig {
  return {
    enabled: true,
    root: DEFAULT_SD_MEMORY_ROOT,
    file: 'MEMORY.md',
    authoring: true,
    auto: {
      enabled: true,
      max_entry_chars: 1200,
      include_assistant: false,
    },
    context: {
      enabled: true,
      max_entries: 5,
    },
    worker: {
      enabled: false,
      interval_ms: 5 * 60 * 1000,
      lookback_sessions: 10,
      include_assistant: false,
    },
  };
}

function defaultAgent(): SdConfig['agent'] {
  return {
    // Output budget counts thinking + final text. With reasoning enabled by
    // default the model can burn a chunk of this before visible output.
    max_tokens: 32_000,
    context: {
      enabled: true,
      fresh_tail_count: 32,
      max_request_tokens: 400_000,
      chunk_target_tokens: 8_000,
      summary_target_tokens: 1_500,
    },
    reasoning: {
      enabled: true,
      effort: 'medium',
    },
  };
}

export function defaultSdConfig(): SdConfig {
  return {
    version: 1,
    default_provider: 'anthropic',
    providers: defaultProviders(),
    sessions: {
      enabled: true,
      root: DEFAULT_SD_SESSION_ROOT,
      index: defaultSessionIndexConfig(),
      title: {
        enabled: true,
        provider: DEFAULT_SD_SESSION_TITLE_PROVIDER,
        model: DEFAULT_SD_SESSION_TITLE_MODEL,
        max_tokens: 48,
      },
    },
    todo: { enabled: true, file: DEFAULT_SD_TODO_PATH },
    skills: {
      authoring: true,
      builtins: true,
      shared_roots: [],
      compatibility_roots: [],
      enabled: [],
      disabled: [],
    },
    memory: defaultMemory(),
    extensions: {
      roots: [DEFAULT_SD_EXTENSION_ROOT],
      enabled: [],
      disabled: [],
      hot_reload: true,
      builtins: true,
    },
    gateway: {
      runtime: 'rust',
      root: DEFAULT_SD_DAEMON_ROOT,
      services: {
        'memory-worker': { enabled: false, restart: 'transient', interval_ms: 5 * 60 * 1000 },
        'skill-builder': { enabled: false, restart: 'transient', interval_ms: 10 * 60 * 1000 },
        'channel-events': {
          enabled: true,
          restart: 'transient',
          interval_ms: 60_000,
          startup_delay_ms: 2_000,
        },
        'session-index': {
          enabled: true,
          restart: 'transient',
          interval_ms: 60_000,
          startup_delay_ms: 2_000,
        },
      },
    },
    background: {
      mode: 'daemon',
      daemon: {
        root: DEFAULT_SD_DAEMON_ROOT,
        auto_start: false,
      },
      channels: {
        enabled: true,
        default_platform: 'local',
        events: {
          enabled: true,
          interval_ms: 60_000,
          startup_delay_ms: 2_000,
          max_events_per_pass: 3,
          max_prompt_chars: 50_000,
          max_response_chars: 24_000,
          max_tokens: 4_000,
        },
      },
    },
    isolation: {
      home: 'profile',
      workspace: 'profile',
      logs: 'profile',
      auth: 'inherit',
    },
    toolsets: {
      enabled: ['file', 'shell', 'repl', 'skill', 'memory', 'todo', 'search'],
      disabled: [],
      denied_tools: [],
    },
    agent: defaultAgent(),
  };
}
