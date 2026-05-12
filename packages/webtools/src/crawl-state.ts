import type { CrawlStatus } from './crawl-types.js';

const crawls = new Map<string, CrawlStatus>();

export function createCrawlStatus(id = makeCrawlId()): CrawlStatus {
  return {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    pagesVisited: 0,
    queued: 1,
    errors: [],
    pages: [],
  };
}

export function rememberCrawlStatus(status: CrawlStatus): void {
  crawls.set(status.id, status);
}

export function getCrawlStatus(id: string): CrawlStatus | undefined {
  return crawls.get(id);
}

function makeCrawlId(): string {
  return `crawl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
