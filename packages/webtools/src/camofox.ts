import type { FetchPageOptions, FetchPageResult } from './http.js';

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
    this.timeoutMs = options.timeoutMs ?? 25_000;
  }

  async available(signal?: AbortSignal): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/health`, {
        method: 'GET',
        signal,
      });
      if (!res.ok) return false;
      const text = await res.text();
      return /ok|healthy|ready/i.test(text) || text.length === 0;
    } catch {
      return false;
    }
  }

  async fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchPageResult> {
    const payload = JSON.stringify({
      url,
      wait_until: 'networkidle',
      timeout_ms: options.timeoutMs ?? this.timeoutMs,
    });
    const candidates = ['/fetch', '/render', '/page'];
    let lastError: unknown;
    for (const path of candidates) {
      try {
        const res = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
          method: 'POST',
          signal: options.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json,text/html' },
          body: payload,
        });
        if (res.status === 404) continue;
        const contentType = res.headers.get('content-type') ?? '';
        const body = await res.text();
        if (contentType.includes('application/json')) {
          const json = JSON.parse(body) as Record<string, unknown>;
          const html =
            stringField(json, 'html') ??
            stringField(json, 'content') ??
            stringField(json, 'body') ??
            '';
          const finalUrl = stringField(json, 'url') ?? stringField(json, 'final_url') ?? url;
          const status = numberField(json, 'status') ?? res.status;
          return { url, finalUrl, status, ok: res.ok, contentType, html, source: 'camofox' };
        }
        return {
          url,
          finalUrl: res.url || url,
          status: res.status,
          ok: res.ok,
          contentType,
          html: body,
          source: 'camofox',
        };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'Camofox request failed'));
  }

  private async fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
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

function stringField(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}
function numberField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
