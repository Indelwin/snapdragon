import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';
import type { SdProviderRuntime } from './provider.js';
import type { InitialRuntimePlan } from './runtime-initial-plan.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { createRuntimeSession } from './runtime-session-create.js';

export function initialRuntimeSession(
  selection: InitialRuntimePlan['sessionSelection'],
  options: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  profile: SdProfileInfo | undefined,
): JsonlSession | undefined {
  return selection.session ?? createdRuntimeSession(selection, options, config, provider, profile);
}

function createdRuntimeSession(
  selection: InitialRuntimePlan['sessionSelection'],
  options: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  profile: SdProfileInfo | undefined,
): JsonlSession | undefined {
  return selection.createAfterProvider
    ? createRuntimeSession(options, config, provider, profile)
    : undefined;
}
