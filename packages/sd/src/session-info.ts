import type { SdConfig } from './config.js';
import { runtimeSessionStore } from './runtime-session.js';
import { type SdSessionSummary, summarizeSession } from './session-summary.js';

export function summaryForSession(
  config: SdConfig,
  sessionId: string,
): SdSessionSummary | undefined {
  try {
    return summarizeSession(runtimeSessionStore(config).open(sessionId));
  } catch {
    return undefined;
  }
}
