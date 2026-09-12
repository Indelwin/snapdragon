import type { CrawlNotRetainedStatus } from './crawl-types.js';

interface StoredMarker {
  value: CrawlNotRetainedStatus;
  expiresAt: number;
}

export class CrawlMarkers {
  readonly #entries = new Map<string, StoredMarker>();

  constructor(
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get size(): number {
    return this.#entries.size;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  get(id: string): CrawlNotRetainedStatus | undefined {
    const marker = this.#entries.get(id)?.value;
    return marker ? { ...marker } : undefined;
  }

  delete(id: string): boolean {
    return this.#entries.delete(id);
  }

  remember(id: string, reason: CrawlNotRetainedStatus['reason']): void {
    const now = this.now();
    this.#entries.delete(id);
    this.#entries.set(id, {
      value: {
        id,
        status: 'not-retained',
        reason,
        recordedAt: new Date(now).toISOString(),
      },
      expiresAt: now + this.ttlMs,
    });
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.#entries.delete(oldest);
    }
  }

  prune(): void {
    const now = this.now();
    for (const [id, marker] of this.#entries) {
      if (marker.expiresAt <= now) this.#entries.delete(id);
    }
  }

  clear(): void {
    this.#entries.clear();
  }
}
