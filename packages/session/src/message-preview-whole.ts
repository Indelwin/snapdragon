import { contentText, truncate, truncateToolCalls } from './message-preview-content.js';
import {
  DEFAULT_MAX_CONTENT_CHARS,
  type ReadMessagePreviewsOptions,
  type SessionMessagePreview,
} from './message-preview-types.js';
import type { SessionMessageRecord } from './records.js';

export function parseWholeMessage(
  line: string,
  options: ReadMessagePreviewsOptions,
): SessionMessagePreview | undefined {
  try {
    return wholeRecordPreview(JSON.parse(line) as SessionMessageRecord, options);
  } catch {
    return undefined;
  }
}

function wholeRecordPreview(
  record: SessionMessageRecord,
  options: ReadMessagePreviewsOptions,
): SessionMessagePreview | undefined {
  if (record.type !== 'message') return undefined;
  return {
    role: record.role,
    created_at: record.created_at,
    contentText: wholeContentText(record, options),
    tool_calls: options.includeToolCalls
      ? truncateToolCalls(record.tool_calls, options)
      : undefined,
  };
}

function wholeContentText(
  record: SessionMessageRecord,
  options: ReadMessagePreviewsOptions,
): string | undefined {
  if (options.includeContent === false) return undefined;
  return truncate(
    contentText(record.content),
    options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
  );
}
