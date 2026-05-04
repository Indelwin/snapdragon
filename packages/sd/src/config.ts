import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { mergeAgentConfig } from './agent-config.js';
import {
  DEFAULT_SD_CONFIG_PATH,
  DEFAULT_SD_ENV_PATH,
  LEGACY_SD_CONFIG_PATH,
} from './config-constants.js';
import { defaultSdConfig } from './config-default.js';
import { configPathForLoad } from './config-path.js';
import type { SdBackgroundConfig } from './config-runtime-types.js';
import type {
  SdConfig,
  SdExtensionsConfig,
  SdMemoryConfig,
  SdProviderConfig,
  SdSessionConfig,
  SdSkillsConfig,
} from './config-schema.js';
import { mergeSessionIndexConfig } from './config-session-index.js';

export type { SdAgentConfig, SdAgentContextConfig } from './agent-config-types.js';
export {
  DEFAULT_SD_CONFIG_PATH,
  DEFAULT_SD_DAEMON_ROOT,
  DEFAULT_SD_ENV_PATH,
  DEFAULT_SD_EXTENSION_ROOT,
  DEFAULT_SD_MEMORY_ROOT,
  DEFAULT_SD_SESSION_ROOT,
  DEFAULT_SD_SESSION_TITLE_MODEL,
  DEFAULT_SD_SESSION_TITLE_PROVIDER,
  DEFAULT_SD_TODO_PATH,
  LEGACY_SD_CONFIG_PATH,
} from './config-constants.js';
export { defaultSdConfig } from './config-default.js';
export type {
  SdConfig,
  SdExtensionsConfig,
  SdMemoryAutoConfig,
  SdMemoryConfig,
  SdMemoryWorkerConfig,
  SdProviderConfig,
  SdProviderKind,
  SdSessionConfig,
  SdSessionTitleConfig,
  SdSkillBuilderConfig,
  SdSkillsConfig,
  SdTodoConfig,
  SdToolsetsConfig,
} from './config-schema.js';
export type { SdTuiConfig, SdTuiMouseConfig } from './tui-config.js';

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
    background: mergeBackgroundConfig(defaults.background, input.background),
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

function mergeBackgroundConfig(
  defaults: SdBackgroundConfig | undefined,
  input: SdBackgroundConfig | undefined,
): SdBackgroundConfig {
  return {
    ...defaults,
    ...(input ?? {}),
    daemon: { ...(defaults?.daemon ?? {}), ...(input?.daemon ?? {}) },
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
