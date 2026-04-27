import { join } from 'node:path';
import { defaultCodingSystemPrompt } from '@snapdragon-ai/agent';
import type {
  SdConfig,
  SdExtensionsConfig,
  SdMemoryConfig,
  SdProviderConfig,
  SdSkillsConfig,
  SdToolsetsConfig,
} from './config.js';
import type { SdProfileInfo } from './profile.js';

export interface SdRuntimeCliOverrides {
  provider?: string;
  model?: string;
}

export interface ResolvedSdRuntimeConfig {
  config: SdConfig;
  systemPrompt?: string;
}

export function resolveSdRuntimeConfig(
  baseConfig: SdConfig,
  profile: SdProfileInfo | undefined | null,
  cliOverrides: SdRuntimeCliOverrides = {},
): ResolvedSdRuntimeConfig {
  const config = cloneConfig(baseConfig);
  applyProfileOverlay(config, profile);
  applyCliOverrides(config, cliOverrides);
  return {
    config,
    systemPrompt: systemPromptForProfile(profile),
  };
}

function applyProfileOverlay(config: SdConfig, profile: SdProfileInfo | undefined | null): void {
  const profileConfig = profile?.config;
  if (!profileConfig) return;
  if (profileConfig.model?.provider) config.default_provider = profileConfig.model.provider;
  const providerId = profileConfig.model?.provider ?? config.default_provider;
  if (profileConfig.model?.name) applyProviderModel(config, providerId, profileConfig.model.name);
  if (profile?.dir) {
    config.sessions = { ...(config.sessions ?? {}), root: join(profile.dir, 'sessions') };
    config.memory = { ...(config.memory ?? {}), root: join(profile.dir, 'memory') };
    config.extensions = {
      ...(config.extensions ?? {}),
      roots: [join(profile.dir, 'extensions'), ...(config.extensions?.roots ?? [])],
    };
  }
  config.agent = { ...config.agent, ...(profileConfig.agent ?? {}) };
  config.toolsets = mergeToolsets(config.toolsets, profileConfig.toolsets);
  config.skills = mergeSkills(config.skills, profileConfig.skills);
  config.memory = mergeMemory(config.memory, profileConfig.memory);
  config.extensions = mergeExtensions(config.extensions, profileConfig.extensions);
  config.isolation = { ...(config.isolation ?? {}), ...(profileConfig.isolation ?? {}) };
}

function applyCliOverrides(config: SdConfig, overrides: SdRuntimeCliOverrides): void {
  if (overrides.provider) config.default_provider = overrides.provider;
  if (overrides.model) applyProviderModel(config, config.default_provider, overrides.model);
}

function applyProviderModel(config: SdConfig, providerId: string, model: string): void {
  const provider = config.providers[providerId];
  if (!provider) return;
  provider.model = model;
}

function systemPromptForProfile(profile: SdProfileInfo | undefined | null): string | undefined {
  const persona = profile?.persona?.trim();
  if (!persona) return undefined;
  return [persona, defaultCodingSystemPrompt()].join('\n\n');
}

function cloneConfig(config: SdConfig): SdConfig {
  return {
    ...config,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([id, provider]) => [id, cloneProvider(provider)]),
    ),
    sessions: config.sessions ? { ...config.sessions } : undefined,
    memory: config.memory
      ? {
          ...config.memory,
          auto: config.memory.auto ? { ...config.memory.auto } : undefined,
          context: config.memory.context ? { ...config.memory.context } : undefined,
        }
      : undefined,
    extensions: config.extensions
      ? {
          ...config.extensions,
          roots: config.extensions.roots ? [...config.extensions.roots] : undefined,
          enabled: config.extensions.enabled ? [...config.extensions.enabled] : undefined,
          disabled: config.extensions.disabled ? [...config.extensions.disabled] : undefined,
        }
      : undefined,
    isolation: config.isolation ? { ...config.isolation } : undefined,
    skills: config.skills
      ? {
          ...config.skills,
          shared_roots: config.skills.shared_roots ? [...config.skills.shared_roots] : undefined,
          compatibility_roots: config.skills.compatibility_roots
            ? [...config.skills.compatibility_roots]
            : undefined,
          enabled: config.skills.enabled ? [...config.skills.enabled] : undefined,
          disabled: config.skills.disabled ? [...config.skills.disabled] : undefined,
        }
      : undefined,
    toolsets: config.toolsets ? cloneToolsets(config.toolsets) : undefined,
    agent: config.agent
      ? {
          ...config.agent,
          reasoning: config.agent.reasoning ? { ...config.agent.reasoning } : undefined,
        }
      : undefined,
  };
}

function mergeMemory(
  base: SdConfig['memory'],
  overlay: Omit<SdMemoryConfig, 'root'> | undefined,
): SdConfig['memory'] {
  if (!base && !overlay) return undefined;
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
    root: base?.root,
    auto: { ...(base?.auto ?? {}), ...(overlay?.auto ?? {}) },
    context: { ...(base?.context ?? {}), ...(overlay?.context ?? {}) },
  };
}

function mergeExtensions(
  base: SdConfig['extensions'],
  overlay: SdExtensionsConfig | undefined,
): SdConfig['extensions'] {
  if (!base && !overlay) return undefined;
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
    roots: overlay?.roots ? [...overlay.roots] : base?.roots,
    enabled: overlay?.enabled ? [...overlay.enabled] : base?.enabled,
    disabled: overlay?.disabled ? [...overlay.disabled] : base?.disabled,
  };
}

function mergeSkills(
  base: SdConfig['skills'],
  overlay: Omit<SdSkillsConfig, 'root'> | undefined,
): SdConfig['skills'] {
  if (!base && !overlay) return undefined;
  return {
    ...(base ?? {}),
    ...(overlay ?? {}),
    root: base?.root,
    shared_roots: overlay?.shared_roots ?? base?.shared_roots,
    compatibility_roots: overlay?.compatibility_roots ?? base?.compatibility_roots,
    enabled: overlay?.enabled ?? base?.enabled,
    disabled: overlay?.disabled ?? base?.disabled,
  };
}

function cloneProvider(provider: SdProviderConfig): SdProviderConfig {
  return {
    ...provider,
    models: provider.models ? [...provider.models] : undefined,
    extra_headers: provider.extra_headers ? { ...provider.extra_headers } : undefined,
    reasoning: provider.reasoning ? { ...provider.reasoning } : undefined,
  };
}

function cloneToolsets(toolsets: SdToolsetsConfig): SdToolsetsConfig {
  return {
    enabled: toolsets.enabled ? [...toolsets.enabled] : undefined,
    disabled: toolsets.disabled ? [...toolsets.disabled] : undefined,
    allowed_tools: toolsets.allowed_tools ? [...toolsets.allowed_tools] : undefined,
    denied_tools: toolsets.denied_tools ? [...toolsets.denied_tools] : undefined,
  };
}

function mergeToolsets(
  base: SdToolsetsConfig | undefined,
  overlay: SdToolsetsConfig | undefined,
): SdToolsetsConfig | undefined {
  if (!base && !overlay) return undefined;
  return {
    ...cloneToolsets(base ?? {}),
    ...cloneToolsets(overlay ?? {}),
  };
}
