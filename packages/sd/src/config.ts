import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { CODEX_MODELS, type ReasoningRequest } from '@snapdragon-ai/host';
import { parse as parseDotenv } from 'dotenv';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { mergeAgentConfig } from './agent-config.js';
import { configPathForLoad } from './config-path.js';
import {
  defaultSessionIndexConfig,
  mergeSessionIndexConfig,
  type SdSessionIndexConfig,
} from './config-session-index.js';

export const DEFAULT_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/sd/config.yaml');
export const LEGACY_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/config.yaml');
export const DEFAULT_SD_ENV_PATH = resolve(homedir(), '.snapdragon/.env');
export const DEFAULT_SD_SESSION_ROOT = resolve(homedir(), '.snapdragon/sd/sessions');
export const DEFAULT_SD_MEMORY_ROOT = resolve(homedir(), '.snapdragon/sd/memory');
export const DEFAULT_SD_EXTENSION_ROOT = resolve(homedir(), '.snapdragon/sd/extensions');
export const DEFAULT_SD_TODO_PATH = resolve(homedir(), '.snapdragon/sd/todos.json');
export const DEFAULT_SD_SESSION_TITLE_PROVIDER = 'anthropic';
export const DEFAULT_SD_SESSION_TITLE_MODEL = 'claude-haiku-4-5-20251001';

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
  /** Enable the background skill-builder service. Default: true (dogfooded). */
  enabled?: boolean;
  /** Polling interval in ms. Default: 30 minutes. */
  interval_ms?: number;
  /** Number of most-recent sessions scanned per pass. Default: 10. */
  lookback_sessions?: number;
  /** Minimum n-gram count across distinct sessions to count as a candidate. Default: 3. */
  min_pattern_count?: number;
  /** Minimum number of distinct sessions in which a pattern must appear. Default: 2. */
  min_distinct_sessions?: number;
  /** Minimum total count required before LLM-drafting a SKILL.md. Default: same as min_pattern_count. */
  min_pattern_count_for_draft?: number;
  /** Cap LLM-drafted SKILL.md outputs per scan pass. Default: 1. */
  max_drafts_per_pass?: number;
  /** max_tokens for the drafter LLM call. Default: 800. */
  draft_max_tokens?: number;
  /**
   * Tool names that, when leading an n-gram, indicate agent-side context
   * gathering rather than a real workflow. Such n-grams are filtered out
   * before scoring. Default targets memory/skill catalog primitives that
   * appear at the start of nearly every session as part of orientation.
   */
  exclude_leading_tools?: string[];
  /**
   * When true, suppress an n-gram if a strict superset n-gram (the same
   * tools at the same starting position, plus more) also passes the
   * thresholds — only the most-specific survivor is kept. Default: true.
   */
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

export interface SdIsolationConfig {
  home?: 'profile' | 'inherit';
  workspace?: 'profile' | 'inherit';
  logs?: 'profile' | 'inherit';
  auth?: 'inherit' | 'profile';
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

export type { SdAgentConfig, SdAgentContextConfig } from './agent-config-types.js';
export type { SdTuiConfig, SdTuiMouseConfig } from './tui-config.js';

import type { SdAgentConfig } from './agent-config-types.js';
import type { SdTuiConfig } from './tui-config.js';

export interface SdConfig {
  version: 1;
  default_provider: string;
  providers: Record<string, SdProviderConfig>;
  sessions?: SdSessionConfig;
  todo?: SdTodoConfig;
  skills?: SdSkillsConfig;
  memory?: SdMemoryConfig;
  extensions?: SdExtensionsConfig;
  isolation?: SdIsolationConfig;
  toolsets?: SdToolsetsConfig;
  agent?: SdAgentConfig;
  tui?: SdTuiConfig;
}

export async function loadSdConfig(
  path = DEFAULT_SD_CONFIG_PATH,
  fallbackPath = LEGACY_SD_CONFIG_PATH,
): Promise<SdConfig> {
  const configPath = configPathForLoad(path, fallbackPath, DEFAULT_SD_CONFIG_PATH);
  if (!existsSync(configPath)) return defaultSdConfig();
  const raw = await readFile(configPath, 'utf8');
  const parsed = parseYaml(raw) as Partial<SdConfig> | null;
  if (!parsed || parsed.version !== 1) {
    throw new Error(`Unsupported sd config at ${configPath}; expected version: 1`);
  }
  return withDefaults(parsed);
}

export function defaultSdConfig(): SdConfig {
  return {
    version: 1,
    default_provider: 'anthropic',
    providers: {
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
    },
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
    memory: {
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
    },
    extensions: {
      roots: [DEFAULT_SD_EXTENSION_ROOT],
      enabled: [],
      disabled: [],
      hot_reload: true,
      builtins: true,
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
    agent: {
      // Output budget — counts thinking + final text. With reasoning
      // enabled by default the model can burn a chunk of this on
      // thinking, so the cap needs real headroom or we'll see
      // `finish_reason=max_tokens` with no content. 32K is well
      // under Anthropic's 64K hard cap on Opus/Sonnet 4.x and leaves
      // plenty of room for thinking + a substantial reply.
      max_tokens: 32_000,
      context: {
        enabled: true,
        fresh_tail_count: 32,
        // Input budget for context windowing. Claude's 1M-token
        // context allows up to ~400K of input before quality starts
        // to degrade noticeably — that's the headroom target rather
        // than the absolute model limit.
        max_request_tokens: 400_000,
        chunk_target_tokens: 8_000,
        summary_target_tokens: 1_500,
      },
      reasoning: {
        enabled: true,
        effort: 'medium',
      },
    },
  };
}

export function withDefaults(input: Partial<SdConfig>): SdConfig {
  const defaults = defaultSdConfig();
  const providerIds = new Set([
    ...Object.keys(defaults.providers),
    ...Object.keys(input.providers ?? {}),
  ]);
  const providers: Record<string, SdProviderConfig> = {};
  for (const id of providerIds) {
    providers[id] = {
      ...(defaults.providers[id] ?? {}),
      ...(input.providers?.[id] ?? {}),
    };
  }

  return {
    version: 1,
    default_provider: input.default_provider ?? defaults.default_provider,
    providers,
    sessions: mergeSessionConfig(defaults.sessions, input.sessions),
    todo: { ...defaults.todo, ...(input.todo ?? {}) },
    skills: mergeSkillsConfig(defaults.skills, input.skills),
    memory: mergeMemoryConfig(defaults.memory, input.memory),
    extensions: mergeExtensionsConfig(defaults.extensions, input.extensions),
    isolation: { ...defaults.isolation, ...(input.isolation ?? {}) },
    toolsets: { ...defaults.toolsets, ...(input.toolsets ?? {}) },
    agent: mergeAgentConfig(defaults.agent, input.agent),
  };
}

function mergeSkillsConfig(
  defaults: SdSkillsConfig | undefined,
  input: SdSkillsConfig | undefined,
): SdSkillsConfig {
  return {
    ...defaults,
    ...(input ?? {}),
    shared_roots: input?.shared_roots ?? defaults?.shared_roots,
    compatibility_roots: input?.compatibility_roots ?? defaults?.compatibility_roots,
    enabled: input?.enabled ?? defaults?.enabled,
    disabled: input?.disabled ?? defaults?.disabled,
  };
}

function mergeMemoryConfig(
  defaults: SdMemoryConfig | undefined,
  input: SdMemoryConfig | undefined,
): SdMemoryConfig {
  return {
    ...defaults,
    ...(input ?? {}),
    auto: { ...(defaults?.auto ?? {}), ...(input?.auto ?? {}) },
    context: { ...(defaults?.context ?? {}), ...(input?.context ?? {}) },
    worker: { ...(defaults?.worker ?? {}), ...(input?.worker ?? {}) },
  };
}

function mergeExtensionsConfig(
  defaults: SdExtensionsConfig | undefined,
  input: SdExtensionsConfig | undefined,
): SdExtensionsConfig {
  return {
    ...defaults,
    ...(input ?? {}),
    roots: input?.roots ?? defaults?.roots,
    enabled: input?.enabled ?? defaults?.enabled,
    disabled: input?.disabled ?? defaults?.disabled,
  };
}

function mergeSessionConfig(
  defaults: SdSessionConfig | undefined,
  input: SdSessionConfig | undefined,
): SdSessionConfig {
  return {
    ...defaults,
    ...(input ?? {}),
    title: { ...(defaults?.title ?? {}), ...(input?.title ?? {}) },
    index: mergeSessionIndexConfig(defaults?.index, input?.index),
  };
}

export async function writeDefaultConfig(
  path = DEFAULT_SD_CONFIG_PATH,
  options: { overwrite?: boolean } = {},
): Promise<boolean> {
  if (existsSync(path) && !options.overwrite) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyYaml(defaultSdConfig()), 'utf8');
  return true;
}

export async function writeEnvTemplate(path = DEFAULT_SD_ENV_PATH): Promise<boolean> {
  if (existsSync(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    '# Snapdragon environment variables.\n# ANTHROPIC_API_KEY=\n# OPENAI_API_KEY=\n',
    'utf8',
  );
  return true;
}

export async function loadSdEnvironment(
  path = DEFAULT_SD_ENV_PATH,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  if (!existsSync(path)) return {};
  const parsed = parseDotenv(await readFile(path));
  for (const [key, value] of Object.entries(parsed)) {
    if (env[key] === undefined) env[key] = value;
  }
  return parsed;
}
