import { type SessionInfo, SessionStore } from '@snapdragon-ai/session';
import { DEFAULT_SD_SESSION_ROOT, type SdConfig } from './config.js';

export function sessionRoot(config: SdConfig): string {
  return config.sessions?.root ?? DEFAULT_SD_SESSION_ROOT;
}

export function runtimeSessionStore(config: SdConfig): SessionStore {
  return new SessionStore({ root: sessionRoot(config) });
}

export function listRuntimeSessions(config: SdConfig): SessionInfo[] {
  return runtimeSessionStore(config).list();
}
