import type { SessionIndexSyncResult } from '@snapdragon-ai/session';

export function summarizeSyncResult(result: SessionIndexSyncResult): string {
  const churn = result.newSessions + result.updatedSessions + result.removedSessions;
  if (churn === 0) return `scanned ${result.scanned}, no changes`;
  return `+${result.newSessions}/~${result.updatedSessions}/-${result.removedSessions} sessions, +${result.newMessages} msgs`;
}
