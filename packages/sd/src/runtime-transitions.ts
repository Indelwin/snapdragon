import type { Message } from '@snapdragon-ai/host';
import type { JsonlSession } from '@snapdragon-ai/session';
import { activateSdExtensions } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig } from './first-party.js';
import type { SdProfileInfo } from './profile.js';
import { resolveSdRuntimeConfig, type SdRuntimeCliOverrides } from './profile-runtime.js';
import { makeSdProvider } from './provider.js';
import { createSdAgent, type SdRuntime } from './runtime.js';
import { runtimeSessionStore, sessionRoot } from './runtime-session.js';
import { ensureRuntimeSessionMeta, runtimeSessionMeta } from './runtime-session-meta-record.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';

export interface SdRuntimeRebuildOptions {
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
  const overrides = runtimeOverrides(runtime, options);
  const { config, systemPrompt } = resolveSdRuntimeConfig(runtime.baseConfig, profile, overrides);
  ensureFirstPartyExtensionsForConfig(config);
  const extensions = createSdExtensionStore(config, profile);
  const extensionRuntime = await activateSdExtensions({
    store: extensions,
    config,
    profile,
    runtimeOptions: runtime.options,
    env: runtime.env,
  });
  const provider = makeSdProvider(config, {}, runtime.env, extensionRuntime.providers);
  const { skills, memory } = createIndexedRuntimeStores(config, profile, extensionRuntime);
  const agent = await createSdAgent(
    runtime.options,
    config,
    provider,
    session,
    skills,
    memory,
    extensionRuntime,
    systemPrompt,
  );

  runtime.config = config;
  runtime.provider = provider;
  runtime.agent = agent;
  runtime.profile = profile;
  runtime.session = session;
  runtime.sessionRoot = session ? sessionRoot(config) : undefined;
  runtime.skills = skills;
  runtime.memory = memory;
  runtime.extensions = extensions;
  runtime.extensionRuntime = extensionRuntime;
  runtime.systemPrompt = systemPrompt;
  runtime.warnings = options.warnings ?? [];
  ensureRuntimeSessionMeta(session, runtime.options, provider, profile);
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
  ensureFirstPartyExtensionsForConfig(config);
  const extensions = createSdExtensionStore(config, profile);
  const extensionRuntime = await activateSdExtensions({
    store: extensions,
    config,
    profile,
    runtimeOptions: runtime.options,
    env: runtime.env,
  });
  const provider = makeSdProvider(config, {}, runtime.env, extensionRuntime.providers);
  const session =
    runtime.options.noSession || config.sessions?.enabled === false
      ? undefined
      : runtimeSessionStore(config).create(
          undefined,
          runtimeSessionMeta(runtime.options, provider, profile),
        );
  await rebuildSdRuntime(runtime, { profile, session });
  recordSystemCommand(
    runtime,
    profile ? `Switched profile to ${profile.name}.` : 'Profile cleared.',
  );
  return profile;
}

export function currentProfileName(runtime: SdRuntime): string {
  return runtime.profile?.name ?? 'none';
}

export function recordSystemCommand(runtime: SdRuntime, content: string): void {
  const message: Message = { role: 'system', content };
  runtime.agent.messages.push(message);
  runtime.session?.appendMessage(message, { meta: { source: 'sd.command' } });
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
