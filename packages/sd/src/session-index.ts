import { SdSessionIndex, type SessionSearchHit } from '@snapdragon-ai/session';
import type {
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import type { SdConfig } from './config.js';
import { sessionRoot } from './runtime-session.js';
import {
  indexIntervalMs,
  resolveSdSessionIndexPath,
  sessionIndexEnabled,
} from './session-index-config.js';
import { summarizeSyncResult } from './session-index-format.js';

export type { SessionSearchHit, SessionSearchOptions } from '@snapdragon-ai/session';
export { SdSessionIndex } from '@snapdragon-ai/session';
export { formatSessionSearchHit, formatSessionSearchHits } from './session-search-format.js';

const DEFAULT_INDEX_STARTUP_DELAY_MS = 2_000;

export { resolveSdSessionIndexPath, sessionIndexEnabled } from './session-index-config.js';

/**
 * Open the session index for `config`. Returns `undefined` if disabled or if
 * SQLite fails to open — callers must treat search as best-effort.
 */
export function openSdSessionIndex(config: SdConfig): SdSessionIndex | undefined {
  if (!sessionIndexEnabled(config)) return undefined;
  try {
    return SdSessionIndex.open(resolveSdSessionIndexPath(config));
  } catch (_err) {
    return undefined;
  }
}

/**
 * Background service that walks the JSONL session root and keeps the index
 * in sync. Runs once shortly after startup and then on a fixed interval.
 */
export function sessionIndexService(opts: {
  index: SdSessionIndex;
  rootFor: (config: SdConfig) => string;
}): SdBackgroundService {
  const { index, rootFor } = opts;
  return {
    name: 'session-index',
    enabled: (ctx) => sessionIndexEnabled(ctx.config),
    intervalMs: (ctx) => indexIntervalMs(ctx.config),
    startupDelayMs: () => DEFAULT_INDEX_STARTUP_DELAY_MS,
    runOnce: async (ctx) => runSessionIndexScan(index, rootFor(ctx.config)),
  };
}

async function runSessionIndexScan(
  index: SdSessionIndex,
  root: string,
): Promise<SdBackgroundServiceResult> {
  const result = index.sync(root);
  return {
    summary: summarizeSyncResult(result),
    metrics: {
      scanned: result.scanned,
      new_sessions: result.newSessions,
      updated_sessions: result.updatedSessions,
      removed_sessions: result.removedSessions,
      new_messages: result.newMessages,
    },
  };
}

// Re-exported for legacy callers that previously typed against this signature.
export function defaultSessionIndexRootFor(): (config: SdConfig) => string {
  return (config) => sessionRoot(config);
}

export type { SdBackgroundContext, SessionSearchHit as SessionSearchHitForCallers };
