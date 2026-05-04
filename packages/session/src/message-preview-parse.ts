import { extractStringField } from './message-preview-fields.js';
import { extractNumberField } from './message-preview-number.js';
import { parseProjectedMessage } from './message-preview-projected.js';
import {
  DEFAULT_MAX_PARSE_LINE_CHARS,
  type ReadMessagePreviewsOptions,
  type SessionMessagePreview,
} from './message-preview-types.js';
import { parseWholeMessage } from './message-preview-whole.js';
import type { SessionMessageRecord } from './records.js';

export function parseMessagePreview(
  line: string,
  options: ReadMessagePreviewsOptions,
): SessionMessagePreview | undefined {
  if (!isMessageLine(line)) return undefined;
  const role = extractStringField(line, 'role') as SessionMessageRecord['role'] | undefined;
  if (!role) return undefined;
  const createdAt = extractNumberField(line, 'created_at') ?? 0;
  return parseBySize(line, role, createdAt, options);
}

function parseBySize(
  line: string,
  role: SessionMessageRecord['role'],
  createdAt: number,
  options: ReadMessagePreviewsOptions,
): SessionMessagePreview | undefined {
  if (shouldParseWholeLine(line, role, options)) {
    return (
      parseWholeMessage(line, options) ?? parseProjectedMessage(line, role, createdAt, options)
    );
  }
  return parseProjectedMessage(line, role, createdAt, options);
}

function isMessageLine(line: string): boolean {
  return line.includes('"type":"message"') || line.includes('"type": "message"');
}

function shouldParseWholeLine(
  line: string,
  role: SessionMessageRecord['role'],
  options: ReadMessagePreviewsOptions,
): boolean {
  return (
    role !== 'tool' && line.length <= (options.maxParseLineChars ?? DEFAULT_MAX_PARSE_LINE_CHARS)
  );
}
