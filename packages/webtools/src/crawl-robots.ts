import type { WebCrawlOptions } from './crawl-types.js';

export async function robotsBodyFor(
  url: string,
  cache: Map<string, string>,
  options: WebCrawlOptions,
): Promise<string | undefined> {
  try {
    const robotsUrl = robotsUrlFor(url);
    if (cache.has(robotsUrl)) return cache.get(robotsUrl);
    const body = await fetchRobots(robotsUrl, options);
    cache.set(robotsUrl, body);
    return body;
  } catch {
    return '';
  }
}

async function fetchRobots(url: string, options: WebCrawlOptions): Promise<string> {
  const res = await fetch(url, {
    signal: options.signal,
    headers: { 'user-agent': options.userAgent ?? 'SnapdragonCrawler/0.1' },
  });
  return res.ok ? await res.text() : '';
}

function robotsUrlFor(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}/robots.txt`;
}
