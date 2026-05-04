import type { MemoryWorkerScanContext } from './memory-worker-context.js';
import { truncateForTitle } from './memory-worker-text.js';

export async function appendMemoryRecord(
  context: MemoryWorkerScanContext,
  sessionId: string,
  content: string,
  trigger: string | undefined,
  hash: string,
): Promise<void> {
  try {
    const appended = await Promise.resolve(
      context.options.memory.append({
        title: `Auto: ${truncateForTitle(content)}`,
        content,
        tags: ['auto', 'tentative', 'worker', trigger ?? 'auto'],
        source: `sd.worker:${sessionId}`,
      }),
    );
    recordAppendResult(context, sessionId, trigger, hash, appended);
  } catch (error) {
    context.result.errors.push(error instanceof Error ? error.message : String(error));
  }
}

function recordAppendResult(
  context: MemoryWorkerScanContext,
  sessionId: string,
  trigger: string | undefined,
  hash: string,
  appended: { success: boolean; error?: string },
): void {
  if (!appended.success) {
    context.result.errors.push(appended.error ?? 'append failed');
    return;
  }
  context.existingHashes.add(hash);
  context.result.captured += 1;
  context.options.log?.(`[memory-worker] captured from ${sessionId} trigger="${trigger}"`);
}
