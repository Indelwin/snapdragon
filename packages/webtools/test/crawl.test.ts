import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueLinks, withinCrawlScope } from '../src/crawl-policy.js';
import type { WebCrawlOptions } from '../src/crawl-types.js';
import type { WebExtractResult } from '../src/extract-page.js';
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
