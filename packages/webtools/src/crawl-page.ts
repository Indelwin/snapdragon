import { enqueueLinks, withinCrawlScope } from './crawl-policy.js';
import { robotsBodyFor } from './crawl-robots.js';
import type { CrawlQueueItem, CrawlStatus, WebCrawlOptions } from './crawl-types.js';
import { webExtract } from './extract-page.js';
import { robots as loadRobots } from './robots.js';
import type { UrlUtils } from './url.js';

interface ProcessCrawlItemArgs {
  status: CrawlStatus;
  queue: CrawlQueueItem[];
  seen: Set<string>;
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
    args.status.pages.push({
      url: args.item.url,
      finalUrl: result.finalUrl,
      depth: args.item.depth,
      title: result.title,
      markdown: result.markdown,
      status: result.status,
      source: result.source,
      links: result.links.map((link) => link.href),
    });
    enqueueLinks(args.queue, args.seen, args.item, result, args.options, args.utils);
  } catch (error) {
    args.status.errors.push(`${args.item.url}: ${errorMessage(error)}`);
  }
}

async function allowedByRobots(args: ProcessCrawlItemArgs): Promise<boolean> {
  const robots = await loadRobots();
  const body = await robotsBodyFor(args.item.url, args.robotsCache, args.options);
  return !body || robots.check(body, args.item.url, args.options.userAgent).allowed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
