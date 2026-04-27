import { type JsonlSession, type SessionInfo, SessionStore } from '@snapdragon-ai/session';
import { DEFAULT_SD_SESSION_ROOT, type SdConfig } from './config.js';
import type { SdProviderRuntime } from './provider.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export function createRuntimeSession(
  args: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
): JsonlSession | undefined {
  if (args.noSession || config.sessions?.enabled === false) return undefined;
  const store = new SessionStore({ root: sessionRoot(config) });
  const meta = runtimeSessionMeta(args, provider);
  if (args.newSession) {
    return store.create(args.sessionId ?? SessionStore.generateId(), meta);
  }
  if (args.resume) {
    const sessionId = args.sessionId ?? latestSessionId(store);
    if (!sessionId) throw new Error('No sessions found to resume.');
    return store.open(sessionId);
  }
  if (args.sessionId) return store.openOrCreate(args.sessionId, meta);
  return store.create(SessionStore.generateId(), meta);
}

export function sessionRoot(config: SdConfig): string {
  return config.sessions?.root ?? DEFAULT_SD_SESSION_ROOT;
}

export function runtimeSessionStore(config: SdConfig): SessionStore {
  return new SessionStore({ root: sessionRoot(config) });
}

export function listRuntimeSessions(config: SdConfig): SessionInfo[] {
  return runtimeSessionStore(config).list();
}

export function runtimeSessionMeta(
  args: Pick<SdRuntimeOptions, 'cwd'>,
  provider: SdProviderRuntime,
): Record<string, unknown> {
  return {
    app: 'sd',
    provider: provider.id,
    model: provider.model,
    cwd: args.cwd,
  };
}

function latestSessionId(store: SessionStore): string | undefined {
  return store.list()[0]?.session_id;
}
