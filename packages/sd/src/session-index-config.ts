import { join } from 'node:path';
import type { SdConfig } from './config.js';
import { DEFAULT_SD_SESSION_INDEX_PATH } from './config-session-index.js';
import { sessionRoot } from './runtime-session.js';

const DEFAULT_INDEX_INTERVAL_MS = 60_000;

/** Resolve the on-disk path of the session FTS/trigram index. */
export function resolveSdSessionIndexPath(config: SdConfig): string {
  return config.sessions?.index?.path ?? defaultIndexPath(config);
}

/** True when the session index is enabled (default on). */
export function sessionIndexEnabled(config: SdConfig): boolean {
  const sessions = config.sessions;
  if (sessions?.enabled === false) return false;
  return sessions?.index?.enabled !== false;
}

export function indexIntervalMs(config: SdConfig): number {
  return config.sessions?.index?.interval_ms ?? DEFAULT_INDEX_INTERVAL_MS;
}

function defaultIndexPath(config: SdConfig): string {
  const root = sessionRoot(config);
  if (!root) return DEFAULT_SD_SESSION_INDEX_PATH;
  return join(root, 'index.sqlite');
}
