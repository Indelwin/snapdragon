import { type MessagePreviewBatch, readMessagePreviewBatch } from '@snapdragon-ai/session';

export async function readMemoryWorkerMessages(args: {
  path: string;
  byteOffset: number;
  skipPartialLine: boolean;
  maxRecords: number;
  maxBytes: number;
  includeAssistant: boolean;
  maxEntryChars?: number;
}): Promise<MessagePreviewBatch> {
  return readMessagePreviewBatch(args.path, {
    startOffset: args.byteOffset,
    skipPartialLine: args.skipPartialLine,
    maxRecords: args.maxRecords,
    maxBytes: args.maxBytes,
    roles: args.includeAssistant ? ['user', 'assistant'] : ['user'],
    includeContent: true,
    includeToolCalls: false,
    maxContentChars: Math.max(1_500, (args.maxEntryChars ?? 1_200) + 300),
  });
}
