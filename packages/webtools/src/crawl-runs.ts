import type { CrawlStatus } from './crawl-types.js';

interface RunningCrawl {
  status: CrawlStatus;
  controller: AbortController;
  completion?: Promise<unknown>;
}

export class CrawlRuns {
  readonly #entries = new Map<string, RunningCrawl>();
  readonly #completions = new Set<Promise<unknown>>();
  #disposePromise: Promise<void> | undefined;

  get size(): number {
    return this.#entries.size;
  }

  has(id: string): boolean {
    return this.#entries.has(id);
  }

  add(status: CrawlStatus): void {
    this.#entries.set(status.id, { status, controller: new AbortController() });
  }

  get(id: string): CrawlStatus | undefined {
    return this.#entries.get(id)?.status;
  }

  delete(id: string): void {
    this.#entries.delete(id);
  }

  run<Result>(
    status: CrawlStatus,
    operation: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> {
    const running = this.#entries.get(status.id);
    if (!running || running.status !== status)
      throw new Error(`crawl is not running: ${status.id}`);
    if (running.completion) throw new Error(`crawl operation already registered: ${status.id}`);
    const completion = Promise.resolve().then(() => operation(running.controller.signal));
    running.completion = completion;
    this.#completions.add(completion);
    void completion.then(
      () => this.#completions.delete(completion),
      () => this.#completions.delete(completion),
    );
    return completion;
  }

  dispose(): Promise<void> {
    if (!this.#disposePromise) {
      const runs = [...this.#entries.values()];
      abortRuns(runs);
      this.#disposePromise = settleRuns(runs, [...this.#completions]).then(() => {
        this.#entries.clear();
        this.#completions.clear();
      });
    }
    return this.#disposePromise;
  }
}

function abortRuns(runs: RunningCrawl[]): void {
  for (const run of runs) {
    markStoreDisposed(run.status);
    run.controller.abort(new Error('crawl store disposed'));
  }
}

async function settleRuns(runs: RunningCrawl[], completions: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(completions);
  for (const run of runs) markStoreDisposed(run.status);
}

function markStoreDisposed(status: CrawlStatus): void {
  status.retention = 'not-retained';
  status.retentionReason = 'store-disposed';
}
