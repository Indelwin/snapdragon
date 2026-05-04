import { extractArrayField } from './message-preview-array.js';
import { fieldValueIndex } from './message-preview-field-index.js';
import { readStringPreview } from './message-preview-string.js';
import {
  DEFAULT_MAX_ARGS_CHARS,
  DEFAULT_MAX_CONTENT_CHARS,
  type ReadMessagePreviewsOptions,
} from './message-preview-types.js';
import type { SessionMessageRecord } from './records.js';

export { contentText } from './message-preview-record-content.js';

export function truncateToolCalls(
  calls: SessionMessageRecord['tool_calls'],
  options: ReadMessagePreviewsOptions,
): SessionMessageRecord['tool_calls'] {
  if (!calls) return undefined;
  const maxArgs = options.maxArgsChars ?? DEFAULT_MAX_ARGS_CHARS;
  return calls.map((call) => ({
    ...call,
    args_json: call.args_json ? truncate(call.args_json, maxArgs) : call.args_json,
  }));
}

export function extractContentText(line: string, options: ReadMessagePreviewsOptions): string {
  const valueIndex = fieldValueIndex(line, 'content');
  if (valueIndex < 0 || line[valueIndex] !== '"') return '';
  return readStringPreview(line, valueIndex, options.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS);
}

export function extractToolCalls(
  line: string,
  options: ReadMessagePreviewsOptions,
): SessionMessageRecord['tool_calls'] {
  const raw = extractArrayField(line, 'tool_calls');
  if (!raw) return undefined;
  return parseToolCalls(raw, options);
}

export function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : value.slice(0, maxChars);
}

function parseToolCalls(
  raw: string,
  options: ReadMessagePreviewsOptions,
): SessionMessageRecord['tool_calls'] {
  try {
    return truncateToolCalls(JSON.parse(raw) as SessionMessageRecord['tool_calls'], options);
  } catch {
    return undefined;
  }
}
