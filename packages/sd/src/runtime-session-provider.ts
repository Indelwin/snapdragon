import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { sessionModelFor } from './runtime-session-provider-model.js';

export interface RuntimeSessionProviderResolution {
  provider?: string;
  model?: string;
  warnings: string[];
}

export function resolveRuntimeSessionProvider(
  session: JsonlSession | undefined,
  config: SdConfig,
  options: Pick<SdRuntimeOptions, 'provider' | 'model'>,
): RuntimeSessionProviderResolution {
  const metadata = session?.metadata();
  const sessionProvider = stringMeta(metadata?.provider);
  const sessionModel = stringMeta(metadata?.model);
  const warnings: string[] = [];
  const provider = options.provider ?? sessionProviderFor(sessionProvider, config, warnings);
  const model =
    options.model ??
    sessionModelFor(
      provider,
      sessionProvider,
      sessionModel,
      Boolean(options.provider),
      config,
      warnings,
    );
  return { provider, model, warnings };
}

function sessionProviderFor(
  provider: string | undefined,
  config: SdConfig,
  warnings: string[],
): string | undefined {
  if (!provider) return undefined;
  if (config.providers[provider]) return provider;
  warnings.push(
    `Session provider '${provider}' is no longer configured; using configured default.`,
  );
  return undefined;
}

function stringMeta(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
