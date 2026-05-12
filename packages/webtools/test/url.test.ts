import assert from 'node:assert/strict';
import { test } from 'node:test';

import { urlUtils } from '../src/url.js';

test('normalize strips tracking and trailing slash', async () => {
  const u = await urlUtils();
  assert.equal(
    u.normalize('https://example.com/path/?utm_source=x&q=1'),
    'https://example.com/path?q=1',
  );
});

test('normalize adds https:// for bare hostnames', async () => {
  const u = await urlUtils();
  assert.equal(u.normalize('example.com/foo'), 'https://example.com/foo');
});

test('normalize returns null for non-URL text', async () => {
  const u = await urlUtils();
  assert.equal(u.normalize('not a url at all'), null);
  assert.equal(u.normalize(''), null);
});

test('canonicalize sorts query params', async () => {
  const u = await urlUtils();
  // Two URLs that differ only in query order canonicalize identically.
  const a = u.canonicalize('https://example.com/p?b=2&a=1');
  const b = u.canonicalize('https://example.com/p?a=1&b=2');
  assert.equal(a, b);
});

test('host extraction and subdomain check', async () => {
  const u = await urlUtils();
  assert.equal(u.host('https://docs.example.com/x'), 'docs.example.com');
  // sameOrSubdomain takes host strings, not URLs — match the Rust signature.
  assert.equal(u.sameOrSubdomain('docs.example.com', 'example.com'), true);
  assert.equal(u.sameOrSubdomain('example.org', 'example.com'), false);
});

test('resolve handles relative paths', async () => {
  const u = await urlUtils();
  assert.equal(u.resolve('https://example.com/a/b/', '../c'), 'https://example.com/a/c');
});

test('patternMatch is not path-segment-aware', async () => {
  const u = await urlUtils();
  // The whole point of using our own matcher: `*` crosses `/`.
  assert.equal(u.patternMatch('https://example.com/docs/page', '*docs*'), true);
  assert.equal(u.patternMatch('anything', '*'), true);
  assert.equal(u.patternMatch('anything', ''), true);
  assert.equal(u.patternMatch('https://example.com/blog', '*docs*'), false);
});
