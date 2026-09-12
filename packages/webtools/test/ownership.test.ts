import assert from 'node:assert/strict';
import test from 'node:test';
import { ContentFilter, contentFilter } from '../src/content-filter.js';
import { Extractor, extractor } from '../src/extractor.js';
import { Robots, robots } from '../src/robots.js';
import { UrlUtils, urlUtils } from '../src/url.js';
import { getWebtoolsWasmMemoryStats, loadWebtools } from '../src/wasm.js';

test('borrowed wrappers do not dispose their shared core', async () => {
  const core = await loadWebtools();
  try {
    const wrappers = [
      new UrlUtils(core, 'borrowed'),
      new Extractor(core, 'borrowed'),
      new ContentFilter(core, 'borrowed'),
      new Robots(core, 'borrowed'),
    ];
    for (const wrapper of wrappers) wrapper.dispose();
    assert.deepEqual(core.call('url_util', { op: 'host', args: { url: 'https://example.com' } }), {
      ok: true,
      value: 'example.com',
    });
  } finally {
    core.dispose();
  }
});

test('wrapper factories return resources that own and dispose their cores', async () => {
  for (const factory of [urlUtils, extractor, contentFilter, robots]) {
    const before = getWebtoolsWasmMemoryStats().activeCores;
    const wrapper = await factory();
    assert.equal(getWebtoolsWasmMemoryStats().activeCores, before + 1);
    wrapper.dispose();
    assert.equal(getWebtoolsWasmMemoryStats().activeCores, before);
  }
});
