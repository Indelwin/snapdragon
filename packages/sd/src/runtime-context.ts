import type { SdConfig } from './config.js';
import type { SdProviderRuntime } from './provider.js';
import { contextSnapshot } from './runtime-context-snapshot.js';

const DEFAULT_EFFECTIVE_PERCENT = 95;

/**
 * Derive the agent's context-budget options. User config wins; when
 * `max_request_tokens` is omitted but the provider exposes per-model
 * `limits.contextWindow`, we derive a sane default by trimming the window
 * with `effectiveContextWindowPercent` (defaults to 95% if unspecified).
 */
export function contextOptions(config: SdConfig, provider?: SdProviderRuntime) {
  const context = config.agent?.context;
  const derivedMax = providerDerivedMaxRequestTokens(provider);
  if (!context && derivedMax === undefined) return undefined;
  return contextSnapshot(context ?? {}, derivedMax);
}

function providerDerivedMaxRequestTokens(
  provider: SdProviderRuntime | undefined,
): number | undefined {
  const limits = provider?.limits;
  if (!limits) return undefined;
  const window = limits.contextWindow;
  if (!window || window <= 0) return undefined;
  const percent = limits.effectiveContextWindowPercent ?? DEFAULT_EFFECTIVE_PERCENT;
  return Math.floor((window * percent) / 100);
}
