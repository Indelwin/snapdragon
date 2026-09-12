import { enqueueLinks, withinCrawlScope } from './crawl-policy.js';
import { robotsBodyFor } from './crawl-robots.js';
import type { CrawlPage, CrawlQueueItem, CrawlStatus, WebCrawlOptions } from './crawl-types.js';
import { webExtract } from './extract-page.js';
import {
  DEFAULT_CRAWL_RESULT_BYTES,
  isResourceLimitError,
  WebtoolsResourceLimitError,
} from './resource-limits.js';
import { robots as loadRobots } from './robots.js';
import type { UrlUtils } from './url.js';

interface ProcessCrawlItemArgs {
  status: CrawlStatus;
  queue: CrawlQueueItem[];
  seen: Set<string>;
  scheduled: Set<string>;
  robotsCache: Map<string, string>;
  seedUrl: string;
  item: CrawlQueueItem;
  options: WebCrawlOptions;
  utils: UrlUtils;
}

export async function processCrawlItem(args: ProcessCrawlItemArgs): Promise<void> {
  if (!withinCrawlScope(args.item.url, args.seedUrl, args.options, args.utils)) return;
  try {
    if (!(await allowedByRobots(args))) return;
    const result = await webExtract(args.item.url, args.options);
    args.status.pagesVisited += 1;
    const page: CrawlPage = {
      url: args.item.url,
      finalUrl: result.finalUrl,
      depth: args.item.depth,
      title: result.title,
      markdown: result.markdown,
      status: result.status,
      source: result.source,
      links: result.links.map((link) => link.href),
    };
    rememberPage(args.status, page, args.options.maxResultBytes ?? DEFAULT_CRAWL_RESULT_BYTES);
    enqueueLinks(
      args.queue,
      args.seen,
      args.item,
      result,
      args.options,
      args.utils,
      args.scheduled,
    );
  } catch (error) {
    if (isResourceLimitError(error)) throw error;
    args.status.errors.push(boundedError(`${args.item.url}: ${errorMessage(error)}`));
  }
}

function rememberPage(status: CrawlStatus, page: CrawlPage, limit: number): void {
  const pageBytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
  const nextBytes = status.resultBytes + pageBytes;
  if (nextBytes > limit) {
    throw new WebtoolsResourceLimitError('crawl result bytes', limit, nextBytes);
  }
  status.resultBytes = nextBytes;
  status.pages.push(page);
}

async function allowedByRobots(args: ProcessCrawlItemArgs): Promise<boolean> {
  const robots = await loadRobots();
  try {
    const body = await robotsBodyFor(args.item.url, args.robotsCache, args.options);
    return !body || robots.check(body, args.item.url, args.options.userAgent).allowed;
  } finally {
    robots.dispose();
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function boundedError(error: string): string {
  const chars = Array.from(error);
  return chars.length <= 4_096 ? error : `${chars.slice(0, 4_080).join('')}...(truncated)`;
}
