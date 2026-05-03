import type { SdConfig } from './config.js';
import { isSessionModelConfigured } from './runtime-session-provider-config.js';

export function sessionModelFor(
  provider: string | undefined,
  sessionProvider: string | undefined,
  model: string | undefined,
  providerWasExplicit: boolean,
  config: SdConfig,
  warnings: string[],
): string | undefined {
  if (!shouldConsiderSessionModel(provider, sessionProvider, model, providerWasExplicit)) {
    return undefined;
  }
  if (isSessionModelConfigured(config, provider as string, model as string)) return model;
  warnings.push(
    `Session model '${model}' is no longer configured for '${provider}'; using configured default.`,
  );
  return undefined;
}

function shouldConsiderSessionModel(
  provider: string | undefined,
  sessionProvider: string | undefined,
  model: string | undefined,
  providerWasExplicit: boolean,
): boolean {
  if (!model || !provider) return false;
  if (providerWasExplicit && provider !== sessionProvider) return false;
  return true;
}
