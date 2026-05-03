import { type JsonlSession, SessionStore } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import type { SdProfileInfo } from './profile.js';
import type { SdProviderRuntime } from './provider.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { sessionRoot } from './runtime-session.js';
import { runtimeSessionMeta } from './runtime-session-meta-record.js';

export function createRuntimeSession(
  args: SdRuntimeOptions,
  config: SdConfig,
  provider: SdProviderRuntime,
  profile?: SdProfileInfo,
): JsonlSession | undefined {
  if (args.noSession || config.sessions?.enabled === false) return undefined;
  const store = new SessionStore({ root: sessionRoot(config) });
  const meta = runtimeSessionMeta(args, provider, profile);
  if (args.newSession) return store.create(args.sessionId ?? SessionStore.generateId(), meta);
  if (args.sessionId) return store.create(args.sessionId, meta);
  return store.create(SessionStore.generateId(), meta);
}
