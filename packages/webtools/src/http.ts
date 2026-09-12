import {
  assertByteLength,
  boundedInteger,
  DEFAULT_HTTP_MAX_BYTES,
  MAX_HTTP_MAX_BYTES,
  MAX_URL_BYTES,
} from './resource-limits.js';
import { type UrlUtils, urlUtils } from './url.js';

export interface FetchPageOptions {
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface FetchPageResult {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType: string;
  html: string;
  truncated: boolean;
  source: 'fetch' | 'jina' | 'camofox';
}

const DEFAULT_UA = 'SnapdragonCrawler/0.1 (+https://github.com/Indelwin/snapdragon)';
const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  assertByteLength(url, 'HTTP URL bytes', MAX_URL_BYTES);
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    'HTTP timeout milliseconds',
    1,
    120_000,
  );
  const maxBytes = boundedInteger(
    options.maxBytes,
    DEFAULT_HTTP_MAX_BYTES,
    'HTTP response bytes',
    1,
    MAX_HTTP_MAX_BYTES,
  );
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const onAbort = () => ac.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: ac.signal,
      headers: {
        'user-agent': options.userAgent ?? DEFAULT_UA,
        accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1',
      },
    });
    const contentType = res.headers.get('content-type') ?? '';
    const body = await readLimitedText(res, maxBytes);
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      contentType,
      html: body.text,
      truncated: body.truncated,
      source: 'fetch',
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export function jinaReaderUrl(url: string): string {
  return `https://r.jina.ai/http://${url.replace(/^https?:\/\//i, '')}`;
}

export async function fetchViaJina(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const jinaUrl = jinaReaderUrl(url);
  const r = await fetchPage(jinaUrl, options);
  return { ...r, url, finalUrl: r.finalUrl, source: 'jina' };
}

export async function shouldUseJina(url: string, helper?: UrlUtils): Promise<boolean> {
  if (helper) return hasJinaPreferredHost(url, helper);
  const utils = await urlUtils();
  try {
    return hasJinaPreferredHost(url, utils);
  } finally {
    utils.dispose();
  }
}

function hasJinaPreferredHost(url: string, utils: UrlUtils): boolean {
  const host = utils.host(url) ?? '';
  return host.endsWith('x.com') || host.endsWith('twitter.com') || host.endsWith('medium.com');
}

export async function readLimitedText(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean; bytesRead: number }> {
  const reader = res.body?.getReader();
  if (!reader) {
    const bytes = new TextEncoder().encode(await res.text());
    return {
      text: new TextDecoder().decode(bytes.slice(0, maxBytes)),
      truncated: bytes.byteLength > maxBytes,
      bytesRead: bytes.byteLength,
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      const allowed = value.byteLength - (total - maxBytes);
      chunks.push(value.slice(0, Math.max(0, allowed)));
      truncated = true;
      await reader.cancel('webtools HTTP response byte budget reached');
      break;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return { text: new TextDecoder().decode(out), truncated, bytesRead: total };
}
