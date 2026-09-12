import assert from 'node:assert/strict';
import test from 'node:test';
import { robots } from '../src/index.js';
import { WebtoolsResourceLimitError } from '../src/resource-limits.js';

test('robots check applies longest matching rule', async () => {
  const r = await robots();
  try {
    const body = `
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 2
Sitemap: https://example.com/sitemap.xml
`;
    const blocked = r.check(body, 'https://example.com/private/page');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.matched_rule, '/private');
    assert.equal(blocked.crawl_delay, 2);
    assert.deepEqual(blocked.sitemaps, ['https://example.com/sitemap.xml']);

    const allowed = r.check(body, 'https://example.com/private/public/page');
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.matched_rule, '/private/public');
  } finally {
    r.dispose();
  }
});

test('direct robots helpers reject inputs above 512 KiB', async () => {
  const r = await robots();
  try {
    const oversized = 'x'.repeat(512 * 1024 + 1);
    for (const invoke of [
      () => r.check(oversized, 'https://example.com'),
      () => r.sitemaps(oversized),
    ]) {
      assert.throws(
        invoke,
        (error) =>
          error instanceof WebtoolsResourceLimitError &&
          error.resource === 'robots.txt input bytes',
      );
    }
  } finally {
    r.dispose();
  }
});
