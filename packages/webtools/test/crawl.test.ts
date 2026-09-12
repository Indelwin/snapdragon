import assert from 'node:assert/strict';
import test from 'node:test';
import { webCrawl } from '../src/crawl.js';
import { enqueueLinks, withinCrawlScope } from '../src/crawl-policy.js';
import { CrawlStore } from '../src/crawl-state.js';
import type { WebCrawlOptions } from '../src/crawl-types.js';
import type { WebExtractResult } from '../src/extract-page.js';
import { WebtoolsResourceLimitError } from '../src/resource-limits.js';
import type { UrlUtils } from '../src/url.js';

const utils: UrlUtils = {
  canonicalize: (url) => url,
  host: (url) => new URL(url).hostname,
  normalize: (url) => url,
  patternMatch: (text, pattern) => pattern === '*' || text.includes(pattern.replaceAll('*', '')),
  resolve: (base, href) => {
    if (href.startsWith('bad:')) return null;
    return new URL(href, base).toString();
  },
  sameOrSubdomain: (host, root) => host === root || host.endsWith(`.${root}`),
};

const result: WebExtractResult = {
  url: 'https://example.com/docs',
  finalUrl: 'https://example.com/docs',
  status: 200,
  source: 'fetch',
  responseTruncated: false,
  title: null,
  description: null,
  byline: null,
  markdown: '',
  text: '',
  links: [
    { href: '/docs/a', text: 'A' },
    { href: '/docs/seen', text: 'Seen' },
    { href: 'bad:value', text: 'Bad' },
    { href: 'https://other.test/page', text: 'Other' },
  ],
  images: [],
  likely_js_only: false,
  truncation: { markdown: false, metadata: false },
  chunks: [],
};

test('enqueueLinks resolves unseen links until the configured depth', () => {
  const queue: Array<{ url: string; depth: number }> = [];
  const seen = new Set(['https://example.com/docs/seen']);
  enqueueLinks(queue, seen, { url: 'https://example.com/docs', depth: 1 }, result, {}, utils);

  assert.deepEqual(queue, [
    { url: 'https://example.com/docs/a', depth: 2 },
    { url: 'https://other.test/page', depth: 2 },
  ]);
});

test('enqueueLinks stops when max depth is reached', () => {
  const queue: Array<{ url: string; depth: number }> = [];
  enqueueLinks(
    queue,
    new Set(),
    { url: 'https://example.com/docs', depth: 2 },
    result,
    { maxDepth: 2 },
    utils,
  );

  assert.deepEqual(queue, []);
});

test('withinCrawlScope applies domain and include/exclude rules', () => {
  const options: WebCrawlOptions = {
    includePatterns: ['*docs*'],
    excludePatterns: ['*private*'],
  };

  assert.equal(
    withinCrawlScope('https://api.example.com/docs/page', 'https://example.com', options, utils),
    true,
  );
  assert.equal(
    withinCrawlScope('https://api.example.com/private/docs', 'https://example.com', options, utils),
    false,
  );
  assert.equal(
    withinCrawlScope('https://other.test/docs/page', 'https://example.com', options, utils),
    false,
  );
  assert.equal(
    withinCrawlScope(
      'https://other.test/docs/page',
      'https://example.com',
      { ...options, sameDomain: false },
      utils,
    ),
    true,
  );
});

test('enqueueLinks rejects frontier growth beyond its explicit budget', () => {
  const queue = [{ url: 'https://example.com/existing', depth: 1 }];
  assert.throws(
    () =>
      enqueueLinks(
        queue,
        new Set(),
        { url: 'https://example.com/docs', depth: 0 },
        result,
        { maxQueuedUrls: 1 },
        utils,
      ),
    (error) =>
      error instanceof WebtoolsResourceLimitError && error.resource === 'crawl queued URLs',
  );
});

test('webCrawl fails explicitly when the complete page would exceed its result budget', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
    return new Response(`<main><h1>Budget</h1><p>${'large page '.repeat(100)}</p></main>`);
  }) as typeof fetch;
  try {
    const store = new CrawlStore();
    const status = await webCrawl(
      'https://example.com',
      {
        maxPages: 1,
        maxResultBytes: 100,
        preferCamofox: false,
        useJina: false,
      },
      store,
    );
    assert.equal(status.status, 'failed');
    assert.equal(status.pagesVisited, 1);
    assert.equal(status.pages.length, 0);
    assert.match(status.errors[0] ?? '', /crawl result bytes budget exceeded/);
    assert.equal(store.get(status.id)?.status, 'failed');
    await store.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('direct webCrawl returns its full bounded result and reports no retention owner', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith('/robots.txt')) return new Response('', { status: 404 });
    return new Response('<main><h1>Complete</h1><p>Full returned page.</p></main>');
  }) as typeof fetch;
  try {
    const status = await webCrawl('https://example.com', {
      maxPages: 1,
      preferCamofox: false,
      useJina: false,
    });
    assert.equal(status.status, 'done');
    assert.equal(status.pages.length, 1);
    assert.match(status.pages[0]?.markdown ?? '', /Full returned page/);
    assert.equal(status.retention, 'not-retained');
    assert.equal(status.retentionReason, 'no-store-owner');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawl applies the request timeout to a never-ending robots response', async () => {
  const originalFetch = globalThis.fetch;
  let robotsAborted = false;
  globalThis.fetch = (async (url, init) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          'abort',
          () => {
            robotsAborted = true;
            reject(signal.reason ?? new Error('robots fetch aborted'));
          },
          { once: true },
        );
      });
    }
    return new Response('<main><h1>Timed</h1><p>Page fetched after robots timeout.</p></main>');
  }) as typeof fetch;
  try {
    const status = await webCrawl('https://example.com', {
      maxPages: 1,
      timeoutMs: 10,
      preferCamofox: false,
      useJina: false,
    });
    assert.equal(robotsAborted, true);
    assert.equal(status.status, 'done');
    assert.equal(status.pagesVisited, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawl store disposal aborts and joins an in-flight robots fetch', async () => {
  const originalFetch = globalThis.fetch;
  let notifyStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let robotsSettled = false;
  globalThis.fetch = (async (_url, init) => {
    notifyStarted?.();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener(
        'abort',
        () => {
          setTimeout(() => {
            robotsSettled = true;
            reject(signal.reason ?? new Error('robots fetch aborted'));
          }, 10);
        },
        { once: true },
      );
    });
  }) as typeof fetch;
  try {
    const store = new CrawlStore();
    const crawl = webCrawl(
      'https://example.com',
      { maxPages: 1, timeoutMs: 120_000, preferCamofox: false, useJina: false },
      store,
    );
    await started;
    await store.dispose();
    assert.equal(robotsSettled, true);
    const status = await crawl;
    assert.equal(status.status, 'failed');
    assert.equal(status.retention, 'not-retained');
    assert.equal(status.retentionReason, 'store-disposed');
    assert.equal(store.diagnostics().runningCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('crawl fails explicitly when robots.txt exceeds 512 KiB', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith('/robots.txt')) {
      return new Response('x'.repeat(512 * 1024 + 1));
    }
    throw new Error('page fetch must not run after an oversized robots response');
  }) as typeof fetch;
  try {
    const store = new CrawlStore();
    const status = await webCrawl(
      'https://example.com',
      { maxPages: 1, preferCamofox: false, useJina: false },
      store,
    );
    assert.equal(status.status, 'failed');
    assert.match(status.errors[0] ?? '', /robots\.txt response bytes budget exceeded/);
    await store.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
