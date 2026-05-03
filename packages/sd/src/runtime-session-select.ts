import { type JsonlSession, SessionStore } from '@snapdragon-ai/session';
import type { SdConfig } from './config.js';
import type { SdRuntimeOptions } from './runtime-options.js';
import { sessionRoot } from './runtime-session.js';

export interface RuntimeSessionSelection {
  session?: JsonlSession;
  createAfterProvider: boolean;
}

export function selectRuntimeSession(
  args: SdRuntimeOptions,
  config: SdConfig,
): RuntimeSessionSelection {
  if (sessionsDisabled(args, config)) return { createAfterProvider: false };
  const store = new SessionStore({ root: sessionRoot(config) });
  if (args.newSession) return { createAfterProvider: true };
  if (args.resume) return resumeSelection(args, store);
  return openOrCreate(args, store);
}

function sessionsDisabled(args: SdRuntimeOptions, config: SdConfig): boolean {
  return Boolean(args.noSession) || config.sessions?.enabled === false;
}

function openOrCreate(args: SdRuntimeOptions, store: SessionStore): RuntimeSessionSelection {
  if (args.sessionId && store.exists(args.sessionId)) {
    return { session: store.open(args.sessionId), createAfterProvider: false };
  }
  return { createAfterProvider: true };
}

function resumeSelection(args: SdRuntimeOptions, store: SessionStore): RuntimeSessionSelection {
  const sessionId = args.sessionId ?? store.list()[0]?.session_id;
  if (!sessionId) throw new Error('No sessions found to resume.');
  return { session: store.open(sessionId), createAfterProvider: false };
}
