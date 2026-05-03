import type { SdConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';
import { resolveSdRuntimeConfig } from './profile-runtime.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { resolveRuntimeSessionProvider } from './runtime-session-provider.js';
import { type RuntimeSessionSelection, selectRuntimeSession } from './runtime-session-select.js';

export interface InitialRuntimePlan {
  config: SdConfig;
  systemPrompt?: string;
  sessionSelection: RuntimeSessionSelection;
  warnings: string[];
}

export function resolveInitialRuntimePlan(
  baseConfig: SdConfig,
  profile: SdProfileInfo | undefined,
  options: SdRuntimeOptions,
): InitialRuntimePlan {
  const initial = resolveSdRuntimeConfig(baseConfig, profile, {
    provider: options.provider,
    model: options.model,
  });
  const sessionSelection = selectRuntimeSession(options, initial.config);
  const providerResolution = resolveRuntimeSessionProvider(
    sessionSelection.session,
    initial.config,
    options,
  );
  const { config, systemPrompt } = resolveSdRuntimeConfig(baseConfig, profile, {
    provider: providerResolution.provider,
    model: providerResolution.model,
  });
  return {
    config,
    systemPrompt,
    sessionSelection,
    warnings: providerResolution.warnings,
  };
}
