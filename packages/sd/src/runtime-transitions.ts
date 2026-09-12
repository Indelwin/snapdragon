import type { JsonlSession } from '@snapdragon-ai/session';
import type { SdProfileInfo } from './profile.js';
import { resolveSdRuntimeConfig, type SdRuntimeCliOverrides } from './profile-runtime.js';
import type { SdRuntime } from './runtime.js';
import { applyRuntimeRebuild } from './runtime-rebuild-services.js';
import { recordSystemCommand } from './runtime-system-command.js';

export interface SdRuntimeRebuildOptions {
  baseConfig?: import('./config.js').SdConfig;
  createSession?: boolean;
  profile?: SdProfileInfo | null;
  session?: JsonlSession | null;
  provider?: string;
  model?: string;
  warnings?: string[];
}

export async function rebuildSdRuntime(
  runtime: SdRuntime,
  options: SdRuntimeRebuildOptions = {},
): Promise<void> {
  const profile = profileOrCurrent(options, runtime.profile);
  const session = sessionOrCurrent(options, runtime.session);
  await applyRuntimeRebuild(runtime, {
    baseConfig: options.baseConfig,
    createSession: options.createSession,
    profile,
    session,
    overrides: runtimeOverrides(runtime, options),
    warnings: options.warnings ?? [],
  });
}

export async function switchRuntimeProfile(
  runtime: SdRuntime,
  name: string | null,
): Promise<SdProfileInfo | undefined> {
  const profile = name === null ? undefined : runtime.profileStore.load(name);
  const { config } = resolveSdRuntimeConfig(
    runtime.baseConfig,
    profile,
    runtimeOverrides(runtime, {}),
  );
  const createSession = !runtime.options.noSession && config.sessions?.enabled !== false;
  await rebuildSdRuntime(runtime, { profile, session: null, createSession });
  recordSystemCommand(
    runtime,
    profile ? `Switched profile to ${profile.name}.` : 'Profile cleared.',
  );
  return profile;
}

export function currentProfileName(runtime: SdRuntime): string {
  return runtime.profile?.name ?? 'none';
}

function runtimeOverrides(
  runtime: SdRuntime,
  options: SdRuntimeRebuildOptions,
): SdRuntimeCliOverrides {
  return {
    provider: options.provider ?? runtime.options.provider,
    model: options.model ?? runtime.options.model,
  };
}

function profileOrCurrent(
  options: SdRuntimeRebuildOptions,
  current: SdProfileInfo | undefined,
): SdProfileInfo | undefined {
  return Object.hasOwn(options, 'profile') ? (options.profile ?? undefined) : current;
}

function sessionOrCurrent(
  options: SdRuntimeRebuildOptions,
  current: JsonlSession | undefined,
): JsonlSession | undefined {
  return Object.hasOwn(options, 'session') ? (options.session ?? undefined) : current;
}
