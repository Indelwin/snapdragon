import { readMessagePreviews, type SessionMessagePreview } from '@snapdragon-ai/session';

export async function readMemoryWorkerMessages(args: {
  path: string;
  watermark: number;
  includeAssistant: boolean;
  maxEntryChars?: number;
}): Promise<SessionMessagePreview[]> {
  return readMessagePreviews(args.path, {
    roles: args.includeAssistant ? ['user', 'assistant'] : ['user'],
    afterCreatedAt: args.watermark,
    includeContent: true,
    includeToolCalls: false,
    maxContentChars: Math.max(1_500, (args.maxEntryChars ?? 1_200) + 300),
  });
}
