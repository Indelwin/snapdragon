import { processCrawlItem } from './crawl-page.js';
import type { CrawlQueueItem, CrawlStatus, WebCrawlOptions } from './crawl-types.js';
import {
  assertByteLength,
  boundedInteger,
  DEFAULT_CRAWL_RESULT_BYTES,
  MAX_CRAWL_DEPTH,
  MAX_CRAWL_PAGES,
  MAX_CRAWL_PATTERN_BYTES,
  MAX_CRAWL_PATTERNS,
  MAX_CRAWL_QUEUE,
  MAX_CRAWL_RESULT_BYTES,
  MAX_URL_BYTES,
  WebtoolsResourceLimitError,
} from './resource-limits.js';
import { type UrlUtils, urlUtils } from './url.js';

export async function crawlInto(
  status: CrawlStatus,
  seed: string,
  options: WebCrawlOptions,
): Promise<void> {
  const boundedOptions = validateOptions(options);
  const utils = await urlUtils();
  try {
    const seedUrl = normalizedSeed(seed, utils);
    const queue: CrawlQueueItem[] = [{ url: seedUrl, depth: 0 }];
    const seen = new Set<string>();
    const scheduled = new Set<string>([seedUrl]);
    const robotsCache = new Map<string, string>();
    while (queue.length > 0 && status.pages.length < boundedOptions.maxPages) {
      status.queued = queue.length;
      const next = queue.shift();
      if (!next || seen.has(next.url)) continue;
      scheduled.delete(next.url);
      seen.add(next.url);
      await processCrawlItem({
        status,
        queue,
        seen,
        scheduled,
        robotsCache,
        seedUrl,
        item: next,
        options: boundedOptions,
        utils,
      });
    }
  } finally {
    utils.dispose();
  }
}

function normalizedSeed(seed: string, utils: UrlUtils): string {
  assertByteLength(seed, 'crawl seed URL bytes', MAX_URL_BYTES);
  const seedUrl = utils.normalize(seed);
  if (!seedUrl) throw new Error(`invalid seed URL: ${seed}`);
  assertByteLength(seedUrl, 'crawl seed URL bytes', MAX_URL_BYTES);
  return seedUrl;
}

function validateOptions(options: WebCrawlOptions): WebCrawlOptions & {
  maxPages: number;
  maxDepth: number;
  maxQueuedUrls: number;
  maxResultBytes: number;
} {
  validatePatterns(options.includePatterns, 'crawl include patterns');
  validatePatterns(options.excludePatterns, 'crawl exclude patterns');
  return {
    ...options,
    maxPages: boundedInteger(options.maxPages, 10, 'crawl pages', 1, MAX_CRAWL_PAGES),
    maxDepth: boundedInteger(options.maxDepth, 2, 'crawl depth', 0, MAX_CRAWL_DEPTH),
    maxQueuedUrls: boundedInteger(
      options.maxQueuedUrls,
      MAX_CRAWL_QUEUE,
      'crawl queued URLs',
      1,
      MAX_CRAWL_QUEUE,
    ),
    maxResultBytes: boundedInteger(
      options.maxResultBytes,
      DEFAULT_CRAWL_RESULT_BYTES,
      'crawl result bytes',
      1,
      MAX_CRAWL_RESULT_BYTES,
    ),
  };
}

function validatePatterns(patterns: string[] | undefined, resource: string): void {
  if (!patterns) return;
  if (patterns.length > MAX_CRAWL_PATTERNS) {
    throw new WebtoolsResourceLimitError(resource, MAX_CRAWL_PATTERNS, patterns.length);
  }
  for (const pattern of patterns)
    assertByteLength(pattern, `${resource} bytes`, MAX_CRAWL_PATTERN_BYTES);
}
