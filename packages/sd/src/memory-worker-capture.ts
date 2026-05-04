import type { SessionMessagePreview } from '@snapdragon-ai/session';
import { appendMemoryRecord } from './memory-worker-append.js';
import { autoCaptureDecision } from './memory-worker-capture-decision.js';
import type { MemoryWorkerScanContext } from './memory-worker-context.js';
import { hashContent } from './memory-worker-text.js';

export async function captureMemoryRecord(
  context: MemoryWorkerScanContext,
  sessionId: string,
  record: SessionMessagePreview,
): Promise<void> {
  const decision = autoCaptureDecision(context, record);
  if (!decision?.extracted) return;
  const hash = hashContent(decision.extracted);
  if (context.existingHashes.has(hash)) {
    context.result.skipped_duplicates += 1;
    return;
  }
  await appendMemoryRecord(context, sessionId, decision.extracted, decision.trigger, hash);
}
