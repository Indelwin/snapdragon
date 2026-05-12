import { processCrawlItem } from './crawl-page.js';
import type { CrawlQueueItem, CrawlStatus, WebCrawlOptions } from './crawl-types.js';
import { type UrlUtils, urlUtils } from './url.js';

export async function crawlInto(
  status: CrawlStatus,
  seed: string,
  options: WebCrawlOptions,
): Promise<void> {
  const utils = await urlUtils();
  const seedUrl = normalizedSeed(seed, utils);
  const queue: CrawlQueueItem[] = [{ url: seedUrl, depth: 0 }];
  const seen = new Set<string>();
  const robotsCache = new Map<string, string>();
  while (queue.length > 0 && status.pages.length < maxPages(options)) {
    status.queued = queue.length;
    const next = queue.shift();
    if (!next || seen.has(next.url)) continue;
    seen.add(next.url);
    await processCrawlItem({
      status,
      queue,
      seen,
      robotsCache,
      seedUrl,
      item: next,
      options,
      utils,
    });
  }
}

function normalizedSeed(seed: string, utils: UrlUtils): string {
  const seedUrl = utils.normalize(seed);
  if (!seedUrl) throw new Error(`invalid seed URL: ${seed}`);
  return seedUrl;
}

function maxPages(options: WebCrawlOptions): number {
  return options.maxPages ?? 10;
}
