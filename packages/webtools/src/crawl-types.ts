import type { WebExtractOptions, WebExtractResult } from './extract-page.js';

export interface WebCrawlOptions extends WebExtractOptions {
  maxPages?: number;
  maxDepth?: number;
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
  errors: string[];
  pages: CrawlPage[];
}

export interface CrawlQueueItem {
  url: string;
  depth: number;
}
