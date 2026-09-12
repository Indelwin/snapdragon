import { crawlInto } from './crawl-runner.js';
import { CrawlStore } from './crawl-state.js';
import type { CrawlLookupResult, CrawlStatus, WebCrawlOptions } from './crawl-types.js';

export type { CrawlStoreDiagnostics, CrawlStoreOptions } from './crawl-state.js';
export { CrawlStore } from './crawl-state.js';
export type {
  CrawlLookupResult,
  CrawlNotRetainedStatus,
  CrawlPage,
  CrawlStatus,
  WebCrawlOptions,
} from './crawl-types.js';

export async function webCrawl(
  seed: string,
  options: WebCrawlOptions = {},
  store?: CrawlStore,
): Promise<CrawlStatus> {
  const crawlStore = store ?? new CrawlStore();
  const status = crawlStore.begin(options.crawlId);
  try {
    await crawlInto(status, seed, options);
    status.status = 'done';
  } catch (error) {
    status.status = 'failed';
    status.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    status.finishedAt = new Date().toISOString();
    status.queued = 0;
    crawlStore.complete(status);
    if (!store) {
      status.retention = 'not-retained';
      status.retentionReason = 'no-store-owner';
      crawlStore.dispose();
    }
  }
  return status;
}

export function crawlStatus(id: string, store: CrawlStore): CrawlLookupResult | undefined {
  return store.get(id);
}

export function deleteCrawl(id: string, store: CrawlStore): boolean {
  return store.delete(id);
}
