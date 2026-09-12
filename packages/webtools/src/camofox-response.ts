import type { FetchPageResult } from './http.js';
import { WebtoolsResourceLimitError } from './resource-limits.js';

interface LimitedText {
  text: string;
  truncated: boolean;
  bytesRead: number;
}

export function parseCamofoxResponse(
  requestedUrl: string,
  response: Response,
  body: LimitedText,
  maxBytes: number,
): FetchPageResult {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {
      url: requestedUrl,
      finalUrl: response.url || requestedUrl,
      status: response.status,
      ok: response.ok,
      contentType,
      html: body.text,
      truncated: body.truncated,
      source: 'camofox',
    };
  }
  if (body.truncated) {
    throw new WebtoolsResourceLimitError('Camofox JSON response bytes', maxBytes, body.bytesRead);
  }
  const json = JSON.parse(body.text) as Record<string, unknown>;
  return {
    url: requestedUrl,
    finalUrl: stringField(json, 'url') ?? stringField(json, 'final_url') ?? requestedUrl,
    status: numberField(json, 'status') ?? response.status,
    ok: response.ok,
    contentType,
    html:
      stringField(json, 'html') ?? stringField(json, 'content') ?? stringField(json, 'body') ?? '',
    truncated: false,
    source: 'camofox',
  };
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}
