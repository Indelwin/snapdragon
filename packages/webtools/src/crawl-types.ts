import type { WebExtractOptions, WebExtractResult } from './extract-page.js';

export interface WebCrawlOptions extends WebExtractOptions {
  maxPages?: number;
  maxDepth?: number;
  maxQueuedUrls?: number;
  maxResultBytes?: number;
  sameDomain?: boolean;
  includePatterns?: string[];
  excludePatterns?: string[];
  crawlId?: string;
}

export interface CrawlPage {
  url: string;
  finalUrl: string;
  depth: number;
  title: string;
  markdown: string;
  status: number;
  source: WebExtractResult['source'];
  links: string[];
  error?: string;
}

export interface CrawlStatus {
  id: string;
  status: 'running' | 'done' | 'failed';
  startedAt: string;
  finishedAt?: string;
  pagesVisited: number;
  queued: number;
  resultBytes: number;
  errors: string[];
  pages: CrawlPage[];
  retention: 'running' | 'retained' | 'not-retained';
  retentionReason?: 'result-too-large' | 'store-disposed' | 'no-store-owner' | 'deleted';
}

export interface CrawlNotRetainedStatus {
  id: string;
  status: 'not-retained';
  reason: 'result-too-large' | 'evicted' | 'expired' | 'deleted' | 'store-disposed';
  recordedAt: string;
}

export type CrawlLookupResult = CrawlStatus | CrawlNotRetainedStatus;

export interface CrawlQueueItem {
  url: string;
  depth: number;
}
