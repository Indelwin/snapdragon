import type { CrawlQueueItem, WebCrawlOptions } from './crawl-types.js';
import type { WebExtractResult } from './extract-page.js';
import { MAX_CRAWL_QUEUE, WebtoolsResourceLimitError } from './resource-limits.js';
import type { UrlUtils } from './url.js';

export function withinCrawlScope(
  url: string,
  seedUrl: string,
  options: WebCrawlOptions,
  utils: UrlUtils,
): boolean {
  return allowedByPatterns(url, options, utils) && allowedByDomain(url, seedUrl, options, utils);
}

export function enqueueLinks(
  queue: CrawlQueueItem[],
  seen: Set<string>,
  current: CrawlQueueItem,
  result: WebExtractResult,
  options: WebCrawlOptions,
  utils: UrlUtils,
  scheduled?: Set<string>,
): void {
  if (current.depth >= (options.maxDepth ?? 2)) return;
  for (const link of result.links) {
    const resolved = utils.resolve(result.finalUrl || current.url, link.href);
    const alreadyScheduled = scheduled
      ? scheduled.has(resolved ?? '')
      : queue.some((item) => item.url === resolved);
    if (!resolved || seen.has(resolved) || alreadyScheduled) continue;
    const limit = options.maxQueuedUrls ?? MAX_CRAWL_QUEUE;
    if (queue.length >= limit) {
      throw new WebtoolsResourceLimitError('crawl queued URLs', limit, queue.length + 1);
    }
    queue.push({ url: resolved, depth: current.depth + 1 });
    scheduled?.add(resolved);
  }
}

function allowedByPatterns(url: string, options: WebCrawlOptions, utils: UrlUtils): boolean {
  return (
    matchesInclude(url, options, utils) &&
    !options.excludePatterns?.some((p) => utils.patternMatch(url, p))
  );
}

function allowedByDomain(
  url: string,
  seedUrl: string,
  options: WebCrawlOptions,
  utils: UrlUtils,
): boolean {
  return (
    options.sameDomain === false ||
    utils.sameOrSubdomain(utils.host(url) ?? '', utils.host(seedUrl) ?? '')
  );
}

function matchesInclude(url: string, options: WebCrawlOptions, utils: UrlUtils): boolean {
  return (
    !options.includePatterns?.length ||
    options.includePatterns.some((p) => utils.patternMatch(url, p))
  );
}
