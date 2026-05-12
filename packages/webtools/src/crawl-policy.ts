import type { CrawlQueueItem, WebCrawlOptions } from './crawl-types.js';
import type { WebExtractResult } from './extract-page.js';
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
): void {
  if (current.depth >= (options.maxDepth ?? 2)) return;
  for (const link of result.links) {
    const resolved = utils.resolve(result.finalUrl || current.url, link.href);
    if (resolved && !seen.has(resolved)) queue.push({ url: resolved, depth: current.depth + 1 });
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
