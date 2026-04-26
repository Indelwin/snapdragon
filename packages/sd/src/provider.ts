import { normalizeProviderConfig, type ResolvedProviderConfig } from '@snapdragon-ai/config';
import {
  anthropicProvider,
  mockProvider,
  openaiCompatibleProvider,
  openaiResponsesProvider,
  type ReasoningRequest,
  type StreamingChatHandler,
} from '@snapdragon-ai/host';
import type { SdConfig, SdProviderConfig, SdProviderKind } from './config.js';

export interface SdProviderRuntime {
  id: string;
  kind: SdProviderKind;
  model: string;
  handler: StreamingChatHandler;
  reasoning?: ReasoningRequest;
}

export function makeSdProvider(
  config: SdConfig,
  overrides: { provider?: string; model?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): SdProviderRuntime {
  const id = overrides.provider ?? config.default_provider;
  const providerConfig = providerConfigFor(config, id);
  const kind = providerKindFor(id, providerConfig);
  const model = overrides.model ?? providerConfig.model ?? providerConfig.default_model;
  if (!model) throw new Error(`Provider '${id}' needs a model`);

  const normalized = normalizeProviderConfig({
    id,
    kind,
    model,
    apiKey: providerConfig.api_key_env ? env[providerConfig.api_key_env] : undefined,
    baseUrl: providerConfig.base_url,
    headers: providerConfig.extra_headers,
    reasoning: providerConfig.reasoning,
  } satisfies ResolvedProviderConfig);

  return {
    id: normalized.id,
    kind,
    model: normalized.model,
    reasoning: normalized.reasoning,
    handler: makeHandler(kind, normalized, providerConfig, env),
  };
}

function providerConfigFor(config: SdConfig, id: string): SdProviderConfig {
  const providerConfig = config.providers[id];
  if (!providerConfig) throw new Error(`Provider '${id}' is not configured`);
  return providerConfig;
}

function providerKindFor(id: string, providerConfig: SdProviderConfig): SdProviderKind {
  if (providerConfig.kind) return providerConfig.kind;
  if (id === 'openai' || id === 'anthropic' || id === 'openai-compatible' || id === 'mock') {
    return id;
  }
  return 'openai-compatible';
}

function makeHandler(
  kind: SdProviderKind,
  provider: ResolvedProviderConfig,
  providerConfig: SdProviderConfig,
  env: NodeJS.ProcessEnv,
): StreamingChatHandler {
  if (kind === 'mock') return mockProvider().handler;
  if (kind === 'openai-codex') {
    throw new Error('openai-codex auth is deferred for sd; use anthropic, openai, or compatible');
  }

  const apiKey = provider.apiKey || requiredEnv(providerConfig.api_key_env, kind, env);
  if (kind === 'anthropic') {
    return anthropicProvider({
      apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
    });
  }
  if (kind === 'openai') {
    return openaiResponsesProvider({
      apiKey,
      model: provider.model,
      baseUrl: provider.baseUrl,
      extraHeaders: provider.headers,
      organization: organization(providerConfig, env),
    });
  }
  return openaiCompatibleProvider({
    apiKey,
    model: provider.model,
    baseUrl: provider.baseUrl,
    extraHeaders: provider.headers,
    organization: organization(providerConfig, env),
  });
}

function requiredEnv(
  name: string | undefined,
  kind: SdProviderKind,
  env: NodeJS.ProcessEnv,
): string {
  const envName = name ?? defaultApiKeyEnv(kind);
  const value = env[envName];
  if (value) return value;
  throw new Error(`${envName} is required for provider kind '${kind}'`);
}

function defaultApiKeyEnv(kind: SdProviderKind): string {
  if (kind === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (kind === 'openai' || kind === 'openai-compatible') return 'OPENAI_API_KEY';
  return 'API_KEY';
}

function organization(config: SdProviderConfig, env: NodeJS.ProcessEnv): string | undefined {
  return config.organization_env ? env[config.organization_env] : undefined;
}
