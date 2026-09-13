import type { SnapdragonAgent } from '@snapdragon-ai/agent';
import type { JsonlSession, SdSessionIndex, SessionStore } from '@snapdragon-ai/session';
import type { SdBackgroundServicesHandle } from './background.js';
import type { SdConfig } from './config.js';
import { activateSdExtensions, type SdExtensionRuntime } from './extension-runtime.js';
import { createSdExtensionStore } from './extensions.js';
import type { SdProfileInfo } from './profile.js';
import type { SdRuntimeCliOverrides } from './profile-runtime.js';
import { makeSdProvider } from './provider.js';
import { createSdAgent, type SdRuntime } from './runtime.js';
import { startRuntimeBackgroundServices } from './runtime-background.js';
import { runtimeSessionStore, sessionRoot } from './runtime-session.js';
import { ensureRuntimeSessionMeta } from './runtime-session-meta-record.js';
import { createIndexedRuntimeStores } from './runtime-stores.js';
import type { SdSearchIndex } from './search-index.js';
import { openSdSessionIndex, sessionIndexEnabled } from './session-index.js';

export interface RuntimeRebuildRequest {
  baseConfig?: SdConfig;
  createSession?: boolean;
  profile?: SdProfileInfo;
  session?: JsonlSession;
  overrides: SdRuntimeCliOverrides;
  warnings?: string[];
}

export type RuntimeRebuildCandidate = Pick<
  SdRuntime,
  | 'agent'
  | 'background'
  | 'baseConfig'
  | 'channels'
  | 'config'
  | 'extensionRuntime'
  | 'extensions'
  | 'memory'
  | 'profile'
  | 'provider'
  | 'searchIndex'
  | 'session'
  | 'sessionIndex'
  | 'sessionRoot'
  | 'skills'
  | 'systemPrompt'
  | 'todo'
  | 'warnings'
>;

export async function prepareRuntimeRebuildCandidate(
  runtime: SdRuntime,
  request: RuntimeRebuildRequest,
  config: SdConfig,
  systemPrompt: string | undefined,
): Promise<RuntimeRebuildCandidate> {
  const resources: CandidateResources = {};
  try {
    const extensions = createSdExtensionStore(config, request.profile);
    const extensionRuntime = await activateSdExtensions({
      store: extensions,
      config,
      profile: request.profile,
      runtimeOptions: runtime.options,
      env: runtime.env,
    });
    resources.extensionRuntime = extensionRuntime;
    const provider = makeSdProvider(config, {}, runtime.env, extensionRuntime.providers);
    const requested = requestedSession(request, config);
    const session = requested.session;
    resources.ownedSession = requested.owned;
    const stores = createIndexedRuntimeStores(config, request.profile, extensionRuntime);
    resources.searchIndex = stores.searchIndex;
    const sessionIndex = openRebuildSessionIndex(config);
    resources.sessionIndex = sessionIndex;
    const agent = await createSdAgent(
      runtime.options,
      config,
      provider,
      session,
      stores.skills,
      stores.memory,
      stores.todo,
      extensionRuntime,
      systemPrompt,
      sessionIndex,
    );
    resources.agent = agent;
    const background = startRuntimeBackgroundServices(
      runtime.options,
      config,
      provider,
      request.profile,
      stores.skills,
      stores.memory,
      stores.channels,
      sessionIndex,
    );
    resources.background = background;
    ensureRuntimeSessionMeta(session, runtime.options, provider, request.profile);
    return {
      agent,
      background,
      baseConfig: request.baseConfig ?? runtime.baseConfig,
      channels: stores.channels,
      config,
      extensionRuntime,
      extensions,
      memory: stores.memory,
      profile: request.profile,
      provider,
      searchIndex: stores.searchIndex,
      session,
      sessionIndex,
      sessionRoot: session ? sessionRoot(config) : undefined,
      skills: stores.skills,
      systemPrompt,
      todo: stores.todo,
      warnings: request.warnings ?? [],
    };
  } catch (error) {
    await disposeCandidate(resources);
    throw error;
  }
}

function requestedSession(
  request: RuntimeRebuildRequest,
  config: SdConfig,
): { session: JsonlSession | undefined; owned?: OwnedCandidateSession } {
  if (!request.createSession) return { session: request.session };
  const store = runtimeSessionStore(config);
  const session = store.create();
  return { session, owned: { session, store } };
}

function openRebuildSessionIndex(config: SdConfig): SdSessionIndex | undefined {
  return sessionIndexEnabled(config) ? openSdSessionIndex(config) : undefined;
}

interface CandidateResources {
  agent?: SnapdragonAgent;
  background?: SdBackgroundServicesHandle;
  sessionIndex?: SdSessionIndex;
  searchIndex?: SdSearchIndex;
  extensionRuntime?: SdExtensionRuntime;
  ownedSession?: OwnedCandidateSession;
}

interface OwnedCandidateSession {
  session: JsonlSession;
  store: SessionStore;
}

async function disposeCandidate(candidate: CandidateResources): Promise<void> {
  await Promise.allSettled([Promise.resolve().then(() => candidate.background?.stop())]);
  await Promise.allSettled([
    candidate.agent?.dispose(),
    candidate.background?.flush(),
    Promise.resolve().then(() => candidate.sessionIndex?.close()),
    Promise.resolve().then(() => candidate.searchIndex?.close()),
    candidate.extensionRuntime?.dispose(),
  ]);
  await Promise.allSettled([
    Promise.resolve().then(() => rollbackEmptyCandidateSession(candidate.ownedSession)),
  ]);
}

function rollbackEmptyCandidateSession(owned: OwnedCandidateSession | undefined): void {
  if (owned?.session.messageCount() === 0) owned.store.delete(owned.session.sessionId);
}
