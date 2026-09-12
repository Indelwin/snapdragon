const ENCODER = new TextEncoder();

export const DEFAULT_HTTP_MAX_BYTES = 2_000_000;
export const MAX_HTTP_MAX_BYTES = 2_000_000;
export const MAX_HTML_INPUT_BYTES = 2_000_000;
export const MAX_URL_BYTES = 8_192;
export const MAX_FILTER_INPUT_BYTES = 1_000_000;
export const MAX_FILTER_QUERY_BYTES = 8_192;
export const MAX_FILTER_CHUNKS = 64;
export const MAX_EXTRACTED_CHARS = 250_000;
export const MAX_CRAWL_PAGES = 100;
export const MAX_CRAWL_DEPTH = 10;
export const MAX_CRAWL_QUEUE = 4_096;
export const DEFAULT_CRAWL_RESULT_BYTES = 8 * 1024 * 1024;
export const MAX_CRAWL_RESULT_BYTES = 16 * 1024 * 1024;
export const MAX_CRAWL_PATTERNS = 64;
export const MAX_CRAWL_PATTERN_BYTES = 1_024;

export class WebtoolsResourceLimitError extends Error {
  readonly code = 'WEBTOOLS_RESOURCE_LIMIT';

  constructor(
    readonly resource: string,
    readonly limit: number,
    readonly actual: number,
  ) {
    super(`${resource} budget exceeded: ${actual} > ${limit}`);
    this.name = 'WebtoolsResourceLimitError';
  }
}

export function byteLength(value: string): number {
  return ENCODER.encode(value).byteLength;
}

export function assertByteLength(value: string, resource: string, limit: number): void {
  const actual = byteLength(value);
  if (actual > limit) throw new WebtoolsResourceLimitError(resource, limit, actual);
}

export function boundedInteger(
  value: number | undefined,
  fallback: number,
  resource: string,
  min: number,
  max: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) {
    throw new WebtoolsResourceLimitError(resource, max, resolved);
  }
  return resolved;
}

export function isResourceLimitError(error: unknown): error is WebtoolsResourceLimitError {
  return error instanceof WebtoolsResourceLimitError;
}
