import type { SessionMessageRecord } from './records.js';

export interface SessionMessagePreview {
  role: SessionMessageRecord['role'];
  created_at: number;
  contentText?: string;
  tool_calls?: SessionMessageRecord['tool_calls'];
}

export interface ReadMessagePreviewsOptions {
  roles?: readonly SessionMessageRecord['role'][];
  afterCreatedAt?: number;
  includeContent?: boolean;
  includeToolCalls?: boolean;
  maxContentChars?: number;
  maxArgsChars?: number;
  maxParseLineChars?: number;
}

export const DEFAULT_MAX_CONTENT_CHARS = 4_000;
export const DEFAULT_MAX_ARGS_CHARS = 1_000;
export const DEFAULT_MAX_PARSE_LINE_CHARS = 256_000;
