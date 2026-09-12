import { CrawlRetention } from './crawl-retention.js';
import type { CrawlLookupResult, CrawlStatus } from './crawl-types.js';
import { assertByteLength, boundedInteger, WebtoolsResourceLimitError } from './resource-limits.js';

const DEFAULT_MAX_COMPLETED_ENTRIES = 32;
const DEFAULT_MAX_COMPLETED_BYTES = 16 * 1024 * 1024;
const DEFAULT_COMPLETED_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_MAX_CONCURRENT_CRAWLS = 4;

export interface CrawlStoreOptions {
  maxCompletedEntries?: number;
  maxCompletedBytes?: number;
  completedTtlMs?: number;
  maxConcurrentCrawls?: number;
  now?: () => number;
}

export interface CrawlStoreDiagnostics {
  runningCount: number;
  completedCount: number;
  notRetainedCount: number;
  retainedBytes: number;
  disposed: boolean;
}

export class CrawlStore {
  readonly maxCompletedEntries: number;
  readonly maxCompletedBytes: number;
  readonly completedTtlMs: number;
  readonly maxConcurrentCrawls: number;

  readonly #now: () => number;
  readonly #running = new Map<string, CrawlStatus>();
  readonly #deleted = new Set<string>();
  readonly #retention: CrawlRetention;
  #disposed = false;

  constructor(options: CrawlStoreOptions = {}) {
    this.maxCompletedEntries = boundedInteger(
      options.maxCompletedEntries,
      DEFAULT_MAX_COMPLETED_ENTRIES,
      'completed crawl entries',
      1,
      1_024,
    );
    this.maxCompletedBytes = boundedInteger(
      options.maxCompletedBytes,
      DEFAULT_MAX_COMPLETED_BYTES,
      'completed crawl retention bytes',
      1,
      256 * 1024 * 1024,
    );
    this.completedTtlMs = boundedInteger(
      options.completedTtlMs,
      DEFAULT_COMPLETED_TTL_MS,
      'completed crawl retention TTL milliseconds',
      1,
      24 * 60 * 60 * 1_000,
    );
    this.maxConcurrentCrawls = boundedInteger(
      options.maxConcurrentCrawls,
      DEFAULT_MAX_CONCURRENT_CRAWLS,
      'concurrent crawls',
      1,
      32,
    );
    this.#now = options.now ?? Date.now;
    this.#retention = new CrawlRetention({
      maxEntries: this.maxCompletedEntries,
      maxBytes: this.maxCompletedBytes,
      ttlMs: this.completedTtlMs,
      now: this.#now,
    });
  }

  begin(id = makeCrawlId()): CrawlStatus {
    this.#assertUsable();
    this.#retention.prune();
    assertByteLength(id, 'crawl id bytes', 256);
    if (this.#running.size >= this.maxConcurrentCrawls) {
      throw new WebtoolsResourceLimitError(
        'concurrent crawls',
        this.maxConcurrentCrawls,
        this.#running.size + 1,
      );
    }
    if (this.#running.has(id) || this.#retention.has(id)) {
      throw new Error(`crawl id already exists: ${id}`);
    }
    const status = createCrawlStatus(id, this.#now());
    this.#running.set(id, status);
    return status;
  }

  complete(status: CrawlStatus): void {
    this.#running.delete(status.id);
    if (this.#disposed) {
      markNotRetained(status, 'store-disposed');
      return;
    }
    if (this.#deleted.delete(status.id)) {
      markNotRetained(status, 'deleted');
      return;
    }
    this.#retention.prune();
    this.#retention.retain(status);
  }

  get(id: string): CrawlLookupResult | undefined {
    this.#assertUsable();
    this.#retention.prune();
    const retained = this.#retention.get(id);
    if (retained) return retained;
    const running = this.#running.get(id);
    return running ? cloneStatus(running) : undefined;
  }

  delete(id: string): boolean {
    this.#assertUsable();
    this.#retention.prune();
    if (this.#running.has(id)) {
      this.#deleted.add(id);
      this.#retention.remember(id, 'deleted');
      return true;
    }
    return this.#retention.delete(id);
  }

  diagnostics(): CrawlStoreDiagnostics {
    if (!this.#disposed) this.#retention.prune();
    return {
      runningCount: this.#running.size,
      completedCount: this.#retention.completedCount,
      notRetainedCount: this.#retention.markerCount,
      retainedBytes: this.#retention.retainedBytes,
      disposed: this.#disposed,
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const status of this.#running.values()) markNotRetained(status, 'store-disposed');
    this.#running.clear();
    this.#retention.clear();
    this.#deleted.clear();
    this.#disposed = true;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error('crawl store is disposed');
  }
}

export function createCrawlStatus(id: string, now = Date.now()): CrawlStatus {
  return {
    id,
    status: 'running',
    startedAt: new Date(now).toISOString(),
    pagesVisited: 0,
    queued: 1,
    resultBytes: 0,
    errors: [],
    pages: [],
    retention: 'running',
  };
}

function makeCrawlId(): string {
  return `crawl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneStatus(status: CrawlStatus): CrawlStatus {
  return JSON.parse(JSON.stringify(status)) as CrawlStatus;
}

function markNotRetained(
  status: CrawlStatus,
  reason: NonNullable<CrawlStatus['retentionReason']>,
): void {
  status.retention = 'not-retained';
  status.retentionReason = reason;
}
