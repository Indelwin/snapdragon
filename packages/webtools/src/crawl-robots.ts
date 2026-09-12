import type { WebCrawlOptions } from './crawl-types.js';
import { readLimitedText } from './http.js';
import { isResourceLimitError, WebtoolsResourceLimitError } from './resource-limits.js';

const MAX_ROBOTS_BYTES = 512 * 1024;
const MAX_ROBOTS_CACHE_ENTRIES = 32;

export async function robotsBodyFor(
  url: string,
  cache: Map<string, string>,
  options: WebCrawlOptions,
): Promise<string | undefined> {
  try {
    const robotsUrl = robotsUrlFor(url);
    if (cache.has(robotsUrl)) return cache.get(robotsUrl);
    const body = await fetchRobots(robotsUrl, options);
    if (cache.size >= MAX_ROBOTS_CACHE_ENTRIES) {
      throw new WebtoolsResourceLimitError(
        'crawl robots cache entries',
        MAX_ROBOTS_CACHE_ENTRIES,
        cache.size + 1,
      );
    }
    cache.set(robotsUrl, body);
    return body;
  } catch (error) {
    if (isResourceLimitError(error)) throw error;
    return '';
  }
}

async function fetchRobots(url: string, options: WebCrawlOptions): Promise<string> {
  const res = await fetch(url, {
    signal: options.signal,
    headers: { 'user-agent': options.userAgent ?? 'SnapdragonCrawler/0.1' },
  });
  if (!res.ok) return '';
  const body = await readLimitedText(res, MAX_ROBOTS_BYTES);
  if (body.truncated) {
    throw new WebtoolsResourceLimitError(
      'robots.txt response bytes',
      MAX_ROBOTS_BYTES,
      body.bytesRead,
    );
  }
  return body.text;
}

function robotsUrlFor(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}
