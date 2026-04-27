import { normalizeProviderConfig, type ResolvedProviderConfig } from '@snapdragon-ai/config';
import {
  anthropicProvider,
  codexProvider,
  listAnthropicModels,
  listCodexModels,
  listOpenAICompatibleModels,
  listOpenAIResponsesModels,
  loadValidCodexAuth,
  mockProvider,
  openaiCompatibleProvider,
  openaiResponsesProvider,
  type ProviderModel,
  type ReasoningRequest,
  type StreamingChatHandler,
} from '@snapdragon-ai/host';
import type { SdConfig, SdProviderConfig, SdProviderKind } from './config.js';
import type { SdRuntime } from './runtime.js';

export interface SdProviderRuntime {
  id: string;
  kind: SdProviderKind;
  model: string;
  handler: StreamingChatHandler;
  reasoning?: ReasoningRequest;
}

export interface SdProviderSummary {
  id: string;
  kind: SdProviderKind;
  active: boolean;
  model?: string;
  models: string[];
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

export function listSdProviders(config: SdConfig, activeId?: string): SdProviderSummary[] {
  return Object.entries(config.providers).map(([id, providerConfig]) => ({
    id,
    kind: providerKindFor(id, providerConfig),
    active: id === activeId,
    model: providerConfig.model ?? providerConfig.default_model,
    models: configuredModels(providerConfig),
  }));
}

export function configuredModelsForProvider(config: SdConfig, providerId: string): string[] {
  return configuredModels(providerConfigFor(config, providerId));
}

export async function discoverSdModels(
  config: SdConfig,
  providerId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ProviderModel[]> {
  const providerConfig = providerConfigFor(config, providerId);
  const kind = providerKindFor(providerId, providerConfig);
  if (kind === 'mock') return [{ id: providerConfig.model ?? 'mock', source: 'static' }];
  if (kind === 'openai-codex') return listCodexModels();

  const apiKey = providerConfig.api_key_env
    ? env[providerConfig.api_key_env]
    : env[defaultApiKeyEnv(kind)];
  const options = {
    apiKey,
    baseUrl: providerConfig.base_url,
    extraHeaders: providerConfig.extra_headers,
    organization: organization(providerConfig, env),
  };
  if (kind === 'anthropic') return listAnthropicModels(options);
  if (kind === 'openai') return listOpenAIResponsesModels(options);
  return listOpenAICompatibleModels(options);
}

export async function switchSdProvider(
  runtime: SdRuntime,
  providerId: string,
  model?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdProviderRuntime> {
  if (runtime.provider.id === providerId && (!model || runtime.provider.model === model)) {
    return runtime.provider;
  }
  const provider = makeSdProvider(runtime.config, { provider: providerId, model }, env);
  runtime.provider = provider;
  runtime.config.default_provider = provider.id;
  runtime.config.providers[provider.id].model = provider.model;
  runtime.agent.setProvider(provider.handler, {
    reasoning: runtime.config.agent?.reasoning ?? provider.reasoning,
  });
  return provider;
}

export async function switchSdModel(
  runtime: SdRuntime,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdProviderRuntime> {
  return switchSdProvider(runtime, runtime.provider.id, model, env);
}

function providerConfigFor(config: SdConfig, id: string): SdProviderConfig {
  const providerConfig = config.providers[id];
  if (!providerConfig) throw new Error(`Provider '${id}' is not configured`);
  return providerConfig;
}

function configuredModels(providerConfig: SdProviderConfig): string[] {
  const models = providerConfig.models ?? [];
  const active = providerConfig.model ?? providerConfig.default_model;
  return [...new Set([active, ...models].filter((model): model is string => Boolean(model)))];
}

function providerKindFor(id: string, providerConfig: SdProviderConfig): SdProviderKind {
  if (providerConfig.kind) return providerConfig.kind;
  if (
    id === 'openai' ||
    id === 'anthropic' ||
    id === 'openai-compatible' ||
    id === 'openai-codex' ||
    id === 'mock'
  ) {
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
    return codexProvider({
      model: provider.model,
      baseUrl: provider.baseUrl,
      auth: () => loadValidCodexAuth({ path: providerConfig.codex_auth_path }),
    });
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
