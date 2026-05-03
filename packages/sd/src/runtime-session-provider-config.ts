import type { SdConfig } from './config.js';

export function isSessionModelConfigured(
  config: SdConfig,
  provider: string,
  model: string,
): boolean {
  const providerConfig = config.providers[provider];
  if (!providerConfig) return false;
  const configured = [
    providerConfig.model,
    providerConfig.default_model,
    ...(providerConfig.models ?? []),
  ].filter((value): value is string => Boolean(value));
  return configured.length === 0 || configured.includes(model);
}
