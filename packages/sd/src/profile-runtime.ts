import { defaultCodingSystemPrompt } from '@snapdragon-ai/agent';
import type { SdConfig, SdProviderConfig, SdToolsetsConfig } from './config.js';
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
  config.agent = { ...config.agent, ...(profileConfig.agent ?? {}) };
  config.toolsets = mergeToolsets(config.toolsets, profileConfig.toolsets);
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
    toolsets: config.toolsets ? cloneToolsets(config.toolsets) : undefined,
    agent: config.agent
      ? {
          ...config.agent,
          reasoning: config.agent.reasoning ? { ...config.agent.reasoning } : undefined,
        }
      : undefined,
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
