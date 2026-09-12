import { parseCamofoxResponse } from './camofox-response.js';
import { type FetchPageOptions, type FetchPageResult, readLimitedText } from './http.js';
import {
  assertByteLength,
  boundedInteger,
  DEFAULT_HTTP_MAX_BYTES,
  isResourceLimitError,
  MAX_HTTP_MAX_BYTES,
  MAX_URL_BYTES,
} from './resource-limits.js';

export interface CamofoxOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class CamofoxClient {
  readonly baseUrl: string;
  readonly timeoutMs: number;

  constructor(options: CamofoxOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.CAMOFOX_URL ?? 'http://localhost:9377').replace(
      /\/$/,
      '',
    );
    this.timeoutMs = boundedInteger(
      options.timeoutMs,
      25_000,
      'Camofox timeout milliseconds',
      1,
      120_000,
    );
  }

  async available(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
        method: 'GET',
        signal,
      });
      if (!res.ok) return false;
      const body = await readLimitedText(res, 1_024);
      return !body.truncated && (/ok|healthy|ready/i.test(body.text) || body.text.length === 0);
    } catch {
      return false;
    }
  }

  async fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchPageResult> {
    assertByteLength(url, 'Camofox URL bytes', MAX_URL_BYTES);
    const maxBytes = boundedInteger(
      options.maxBytes,
      DEFAULT_HTTP_MAX_BYTES,
      'Camofox response bytes',
      1,
      MAX_HTTP_MAX_BYTES,
    );
    const timeoutMs = boundedInteger(
      options.timeoutMs,
      this.timeoutMs,
      'Camofox render timeout milliseconds',
      1,
      120_000,
    );
    const payload = JSON.stringify({
      url,
      wait_until: 'networkidle',
      timeout_ms: timeoutMs,
    });
    const candidates = ['/fetch', '/render', '/page'];
    let lastError: unknown;
    for (const path of candidates) {
      try {
        const res = await this.fetchWithTimeout(
          `${this.baseUrl}${path}`,
          {
            method: 'POST',
            signal: options.signal,
            headers: { 'content-type': 'application/json', accept: 'application/json,text/html' },
            body: payload,
          },
          timeoutMs,
        );
        if (res.status === 404) continue;
        const body = await readLimitedText(res, maxBytes);
        return parseCamofoxResponse(url, res, body, maxBytes);
      } catch (error) {
        if (isResourceLimitError(error)) throw error;
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'Camofox request failed'));
  }

  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs = this.timeoutMs,
  ): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onAbort = () => ac.abort();
    init.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      return await fetch(input, { ...init, signal: ac.signal });
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener('abort', onAbort);
    }
  }
}
