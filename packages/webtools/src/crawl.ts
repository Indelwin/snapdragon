import { crawlInto } from './crawl-runner.js';
import { createCrawlStatus, getCrawlStatus, rememberCrawlStatus } from './crawl-state.js';
import type { CrawlStatus, WebCrawlOptions } from './crawl-types.js';

export type { CrawlPage, CrawlStatus, WebCrawlOptions } from './crawl-types.js';

export async function webCrawl(seed: string, options: WebCrawlOptions = {}): Promise<CrawlStatus> {
  const status = createCrawlStatus(options.crawlId);
  rememberCrawlStatus(status);
  try {
    await crawlInto(status, seed, options);
    status.status = 'done';
  } catch (error) {
    status.status = 'failed';
    status.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    status.finishedAt = new Date().toISOString();
    status.queued = 0;
  }
  return status;
}

export function crawlStatus(id: string): CrawlStatus | undefined {
  return getCrawlStatus(id);
}
