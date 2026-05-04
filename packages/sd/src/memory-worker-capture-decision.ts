import { memoryShouldAutoCapture } from '@snapdragon-ai/content';
import type { SessionMessagePreview } from '@snapdragon-ai/session';
import type { MemoryWorkerScanContext } from './memory-worker-context.js';

export function autoCaptureDecision(
  context: MemoryWorkerScanContext,
  record: SessionMessagePreview,
) {
  if (record.role !== 'user') return undefined;
  const userInput = record.contentText?.trim() ?? '';
  if (!userInput) return undefined;
  const memoryConfig = context.options.config.memory;
  const decision = memoryShouldAutoCapture(
    { userInput },
    {
      enabled: memoryConfig?.auto?.enabled,
      triggers: memoryConfig?.auto?.triggers,
      maxEntryChars: memoryConfig?.auto?.max_entry_chars,
      includeAssistant: context.includeAssistant,
    },
  );
  return decision.capture && decision.extracted ? decision : undefined;
}
