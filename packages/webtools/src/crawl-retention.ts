import { CrawlMarkers } from './crawl-markers.js';
import type { CrawlLookupResult, CrawlNotRetainedStatus, CrawlStatus } from './crawl-types.js';

const ENCODER = new TextEncoder();

interface CrawlRetentionOptions {
  maxEntries: number;
  maxBytes: number;
  ttlMs: number;
  now: () => number;
}

interface StoredCrawl {
  serialized: string;
  bytes: number;
  expiresAt: number;
}

export class CrawlRetention {
  readonly #completed = new Map<string, StoredCrawl>();
  readonly #markers: CrawlMarkers;
  #retainedBytes = 0;

  constructor(private readonly options: CrawlRetentionOptions) {
    this.#markers = new CrawlMarkers(options.maxEntries, options.ttlMs, options.now);
  }

  get completedCount(): number {
    return this.#completed.size;
  }

  get markerCount(): number {
    return this.#markers.size;
  }

  get retainedBytes(): number {
    return this.#retainedBytes;
  }

  has(id: string): boolean {
    return this.#completed.has(id) || this.#markers.has(id);
  }

  retain(status: CrawlStatus): void {
    status.retention = 'retained';
    delete status.retentionReason;
    const serialized = JSON.stringify(status);
    const bytes = ENCODER.encode(serialized).byteLength;
    if (bytes > this.options.maxBytes) {
      markNotRetained(status, 'result-too-large');
      this.#markers.remember(status.id, 'result-too-large');
      return;
    }

    this.#removeCompleted(status.id);
    this.#markers.delete(status.id);
    this.#completed.set(status.id, {
      serialized,
      bytes,
      expiresAt: this.options.now() + this.options.ttlMs,
    });
    this.#retainedBytes += bytes;
    this.#enforceLimits();
  }

  get(id: string): CrawlLookupResult | undefined {
    const completed = this.#completed.get(id);
    if (completed) return JSON.parse(completed.serialized) as CrawlStatus;
    return this.#markers.get(id);
  }

  delete(id: string): boolean {
    if (!this.#removeCompleted(id)) return false;
    this.#markers.delete(id);
    this.#markers.remember(id, 'deleted');
    return true;
  }

  remember(id: string, reason: CrawlNotRetainedStatus['reason']): void {
    this.#markers.remember(id, reason);
  }

  prune(): void {
    this.#markers.prune();
    const now = this.options.now();
    for (const [id, entry] of this.#completed) {
      if (entry.expiresAt <= now) {
        this.#removeCompleted(id);
        this.#markers.remember(id, 'expired');
      }
    }
  }

  clear(): void {
    this.#completed.clear();
    this.#markers.clear();
    this.#retainedBytes = 0;
  }

  #enforceLimits(): void {
    while (this.#overBudget()) {
      const oldest = this.#completed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#removeCompleted(oldest);
      this.#markers.remember(oldest, 'evicted');
    }
  }

  #overBudget(): boolean {
    return (
      this.#completed.size > this.options.maxEntries || this.#retainedBytes > this.options.maxBytes
    );
  }

  #removeCompleted(id: string): boolean {
    const entry = this.#completed.get(id);
    if (!entry) return false;
    this.#completed.delete(id);
    this.#retainedBytes -= entry.bytes;
    return true;
  }
}

function markNotRetained(status: CrawlStatus, reason: 'result-too-large'): void {
  status.retention = 'not-retained';
  status.retentionReason = reason;
}
