import { extractContentText, extractToolCalls } from './message-preview-content.js';
import type { ReadMessagePreviewsOptions, SessionMessagePreview } from './message-preview-types.js';
import type { SessionMessageRecord } from './records.js';

export function parseProjectedMessage(
  line: string,
  role: SessionMessageRecord['role'],
  createdAt: number,
  options: ReadMessagePreviewsOptions,
): SessionMessagePreview {
  return {
    role,
    created_at: createdAt,
    contentText: options.includeContent === false ? undefined : extractContentText(line, options),
    tool_calls: options.includeToolCalls ? extractToolCalls(line, options) : undefined,
  };
}
