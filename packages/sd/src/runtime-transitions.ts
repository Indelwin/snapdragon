import type { Message } from '@snapdragon-ai/host';
import type { JsonlSession, SessionInfo } from '@snapdragon-ai/session';
import { activateSdExtensions } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import { ensureFirstPartyExtensionsForConfig } from './first-party.js';
import { createSdMemoryStore } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import { resolveSdRuntimeConfig, type SdRuntimeCliOverrides } from './profile-runtime.js';
import { makeSdProvider } from './provider.js';
import { createSdAgent, type SdRuntime } from './runtime.js';
import {
  listRuntimeSessions,
  runtimeSessionMeta,
  runtimeSessionStore,
  sessionRoot,
} from './runtime-session.js';
import { createSdSkillStore } from './skills.js';

export interface SdRuntimeRebuildOptions {
  profile?: SdProfileInfo | null;
  session?: JsonlSession | null;
  provider?: string;
  model?: string;
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
  const skills = createSdSkillStore(config, profile, extensionRuntime.skillRoots);
  const memory = createSdMemoryStore(config, profile, extensionRuntime.memoryProviders);
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
}

export async function resumeRuntimeSession(
  runtime: SdRuntime,
  sessionId?: string,
): Promise<JsonlSession> {
  assertSessionsEnabled(runtime);
  const store = runtimeSessionStore(runtime.config);
  const id = sessionId ?? store.list()[0]?.session_id;
  if (!id) throw new Error('No sessions found to resume.');
  const session = store.open(id);
  await rebuildSdRuntime(runtime, {
    session,
    provider: runtime.provider.id,
    model: runtime.provider.model,
  });
  return session;
}

export async function newRuntimeSession(
  runtime: SdRuntime,
  sessionId?: string,
): Promise<JsonlSession> {
  assertSessionsEnabled(runtime);
  const store = runtimeSessionStore(runtime.config);
  const session = store.create(sessionId, runtimeSessionMeta(runtime.options, runtime.provider));
  await rebuildSdRuntime(runtime, {
    session,
    provider: runtime.provider.id,
    model: runtime.provider.model,
  });
  return session;
}

export function deleteRuntimeSession(runtime: SdRuntime, sessionId: string): boolean {
  assertSessionsEnabled(runtime);
  if (runtime.session?.sessionId === sessionId) {
    throw new Error(`Cannot delete active session '${sessionId}'.`);
  }
  return runtimeSessionStore(runtime.config).delete(sessionId);
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
          runtimeSessionMeta(runtime.options, provider),
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

export function listSessions(runtime: SdRuntime): SessionInfo[] {
  return listRuntimeSessions(runtime.config);
}

export function recordSystemCommand(runtime: SdRuntime, content: string): void {
  const message: Message = { role: 'system', content };
  runtime.agent.messages.push(message);
  runtime.session?.appendMessage(message, { meta: { source: 'sd.command' } });
}

function assertSessionsEnabled(runtime: SdRuntime): void {
  if (runtime.options.noSession || runtime.config.sessions?.enabled === false) {
    throw new Error('Sessions are disabled for this run.');
  }
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
