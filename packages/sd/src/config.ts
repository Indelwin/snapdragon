import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { CODEX_MODELS, type ReasoningRequest } from '@snapdragon-ai/host';
import { parse as parseDotenv } from 'dotenv';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export const DEFAULT_SD_CONFIG_PATH = resolve(homedir(), '.snapdragon/sd/config.yaml');
export const DEFAULT_SD_ENV_PATH = resolve(homedir(), '.snapdragon/.env');
export const DEFAULT_SD_SESSION_ROOT = resolve(homedir(), '.snapdragon/sd/sessions');
export const DEFAULT_SD_SESSION_TITLE_PROVIDER = 'anthropic';
export const DEFAULT_SD_SESSION_TITLE_MODEL = 'claude-haiku-4-5-20251001';

export type SdProviderKind = 'anthropic' | 'openai' | 'openai-compatible' | 'mock' | 'openai-codex';

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
}

export interface SdToolsetsConfig {
  enabled?: string[];
  disabled?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
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

export interface SdAgentConfig {
  max_turns?: number;
  temperature?: number;
  max_tokens?: number;
  reasoning?: ReasoningRequest;
}

export interface SdConfig {
  version: 1;
  default_provider: string;
  providers: Record<string, SdProviderConfig>;
  sessions?: SdSessionConfig;
  toolsets?: SdToolsetsConfig;
  agent?: SdAgentConfig;
}

export async function loadSdConfig(path = DEFAULT_SD_CONFIG_PATH): Promise<SdConfig> {
  if (!existsSync(path)) return defaultSdConfig();
  const raw = await readFile(path, 'utf8');
  const parsed = parseYaml(raw) as Partial<SdConfig> | null;
  if (!parsed || parsed.version !== 1) {
    throw new Error(`Unsupported sd config at ${path}; expected version: 1`);
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
    toolsets: {
      enabled: ['file', 'shell', 'repl'],
      disabled: [],
      denied_tools: [],
    },
    agent: {
      max_turns: 32,
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
    toolsets: { ...defaults.toolsets, ...(input.toolsets ?? {}) },
    agent: { ...defaults.agent, ...(input.agent ?? {}) },
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
