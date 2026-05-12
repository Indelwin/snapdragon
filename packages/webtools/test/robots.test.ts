import assert from 'node:assert/strict';
import test from 'node:test';
import { robots } from '../src/index.js';

test('robots check applies longest matching rule', async () => {
  const r = await robots();
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
});
