import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { CODEX_MODELS, type ReasoningRequest } from '@snapdragon-ai/host';
import { parse as parseDotenv } from 'dotenv';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { mergeAgentConfig } from './agent-config.js';
import { configPathForLoad } from './config-path.js';

export const DEFAULT_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/sd/config.yaml');
export const LEGACY_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/config.yaml');
export const DEFAULT_SD_ENV_PATH = resolve(homedir(), '.snapdragon/.env');
export const DEFAULT_SD_SESSION_ROOT = resolve(homedir(), '.snapdragon/sd/sessions');
export const DEFAULT_SD_MEMORY_ROOT = resolve(homedir(), '.snapdragon/sd/memory');
export const DEFAULT_SD_EXTENSION_ROOT = resolve(homedir(), '.snapdragon/sd/extensions');
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
}

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

export interface SdConfig {
  version: 1;
  default_provider: string;
  providers: Record<string, SdProviderConfig>;
  sessions?: SdSessionConfig;
  skills?: SdSkillsConfig;
  memory?: SdMemoryConfig;
  extensions?: SdExtensionsConfig;
  isolation?: SdIsolationConfig;
  toolsets?: SdToolsetsConfig;
  agent?: SdAgentConfig;
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
      mock: {
        kind: 'mock',
        model: 'mock',
      },
      'openai-codex': {
        kind: 'openai-codex',
        model: 'gpt-5.5',
        models: [...CODEX_MODELS],
      },
    },
    sessions: {
      enabled: true,
      root: DEFAULT_SD_SESSION_ROOT,
      title: {
        enabled: true,
        provider: DEFAULT_SD_SESSION_TITLE_PROVIDER,
        model: DEFAULT_SD_SESSION_TITLE_MODEL,
        max_tokens: 48,
      },
    },
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
      enabled: ['file', 'shell', 'repl', 'skill', 'memory'],
      disabled: [],
      denied_tools: [],
    },
    agent: {
      context: {
        enabled: true,
        fresh_tail_count: 32,
        max_request_tokens: 120_000,
        chunk_target_tokens: 8_000,
        summary_target_tokens: 1_500,
      },
      // Extended thinking is on by default; tune with `effort` or disable via config.
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
    ['# Snapdragon environment variables.', '# ANTHROPIC_API_KEY=', '# OPENAI_API_KEY=', ''].join(
      '\n',
    ),
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
