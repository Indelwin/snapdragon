import type { JsonlSession, SessionInfo } from '@snapdragon-ai/session';
import type { SdRuntime } from './runtime.js';
import { listRuntimeSessions, runtimeSessionStore } from './runtime-session.js';
import { runtimeSessionMeta } from './runtime-session-meta-record.js';
import { resolveRuntimeSessionProvider } from './runtime-session-provider.js';
import { rebuildSdRuntime } from './runtime-transitions.js';

export async function resumeRuntimeSession(
  runtime: SdRuntime,
  sessionId?: string,
): Promise<JsonlSession> {
  assertSessionsEnabled(runtime);
  const store = runtimeSessionStore(runtime.config);
  const id = sessionId ?? store.list()[0]?.session_id;
  if (!id) throw new Error('No sessions found to resume.');
  const session = store.open(id);
  const providerResolution = resolveRuntimeSessionProvider(
    session,
    runtime.config,
    runtime.options,
  );
  await rebuildSdRuntime(runtime, {
    session,
    provider: providerResolution.provider,
    model: providerResolution.model,
    warnings: providerResolution.warnings,
  });
  return session;
}

export async function newRuntimeSession(
  runtime: SdRuntime,
  sessionId?: string,
): Promise<JsonlSession> {
  assertSessionsEnabled(runtime);
  const store = runtimeSessionStore(runtime.config);
  const session = store.create(
    sessionId,
    runtimeSessionMeta(runtime.options, runtime.provider, runtime.profile),
  );
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

export function listSessions(runtime: SdRuntime): SessionInfo[] {
  return listRuntimeSessions(runtime.config);
}

function assertSessionsEnabled(runtime: SdRuntime): void {
  if (runtime.options.noSession || runtime.config.sessions?.enabled === false) {
    throw new Error('Sessions are disabled for this run.');
  }
}
