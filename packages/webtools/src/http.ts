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
  source: 'fetch' | 'jina' | 'camofox';
}

const DEFAULT_UA = 'SnapdragonCrawler/0.1 (+https://github.com/Indelwin/snapdragon)';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2_000_000;

export async function fetchPage(
  url: string,
  options: FetchPageOptions = {},
): Promise<FetchPageResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
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
    const html = await readLimitedText(res, options.maxBytes ?? DEFAULT_MAX_BYTES);
    return {
      url,
      finalUrl: res.url || url,
      status: res.status,
      ok: res.ok,
      contentType,
      html,
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
  const utils = helper ?? (await urlUtils());
  const host = utils.host(url) ?? '';
  return host.endsWith('x.com') || host.endsWith('twitter.com') || host.endsWith('medium.com');
}

async function readLimitedText(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      const allowed = value.byteLength - (total - maxBytes);
      chunks.push(value.slice(0, Math.max(0, allowed)));
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
  return new TextDecoder().decode(out);
}
