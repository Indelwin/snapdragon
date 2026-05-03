import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import type { SdExtensionProviderFactory } from './extension-runtime.js';
import type { SdProfileInfo } from './profile.js';
import { makeSdProvider, type SdProviderRuntime } from './provider.js';
import { contextOptions } from './runtime-context.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { ensureRuntimeSessionMeta } from './runtime-session-meta-record.js';

interface AgentSetProviderOptions {
  reasoning?: SdProviderRuntime['reasoning'];
  context?: ReturnType<typeof contextOptions>;
}

interface ProviderSwitchRuntime {
  provider: SdProviderRuntime;
  config: SdConfig;
  extensionRuntime: { providers: Map<string, SdExtensionProviderFactory> };
  agent: {
    setProvider(handler: SdProviderRuntime['handler'], options?: AgentSetProviderOptions): void;
  };
  session?: JsonlSession;
  options: SdRuntimeOptions;
  profile?: SdProfileInfo;
  warnings: string[];
}

export async function switchSdProvider(
  runtime: ProviderSwitchRuntime,
  providerId: string,
  model?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdProviderRuntime> {
  if (runtime.provider.id === providerId && (!model || runtime.provider.model === model)) {
    return runtime.provider;
  }
  const provider = makeSdProvider(
    runtime.config,
    { provider: providerId, model },
    env,
    runtime.extensionRuntime.providers,
  );
  runtime.provider = provider;
  runtime.config.default_provider = provider.id;
  runtime.config.providers[provider.id].model = provider.model;
  runtime.agent.setProvider(provider.handler, {
    reasoning: runtime.config.agent?.reasoning ?? provider.reasoning,
    context: contextOptions(runtime.config, provider),
  });
  runtime.warnings = [];
  ensureRuntimeSessionMeta(runtime.session, runtime.options, provider, runtime.profile);
  return provider;
}

export async function switchSdModel(
  runtime: ProviderSwitchRuntime,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SdProviderRuntime> {
  return switchSdProvider(runtime, runtime.provider.id, model, env);
}
