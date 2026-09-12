import type { WebCrawlOptions } from './crawl-types.js';
import { fetchPage } from './http.js';
import {
  isResourceLimitError,
  MAX_ROBOTS_BYTES,
  WebtoolsResourceLimitError,
} from './resource-limits.js';

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
    if (options.signal?.aborted) throw error;
    if (isResourceLimitError(error)) throw error;
    return '';
  }
}

async function fetchRobots(url: string, options: WebCrawlOptions): Promise<string> {
  const response = await fetchPage(url, { ...options, maxBytes: MAX_ROBOTS_BYTES });
  if (!response.ok) return '';
  if (response.truncated) {
    throw new WebtoolsResourceLimitError(
      'robots.txt response bytes',
      MAX_ROBOTS_BYTES,
      MAX_ROBOTS_BYTES + 1,
    );
  }
  return response.html;
}

function robotsUrlFor(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}
