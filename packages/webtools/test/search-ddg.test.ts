import assert from 'node:assert/strict';
import test from 'node:test';
import { ddgHtml } from '../src/search-ddg.js';

test('DuckDuckGo HTML search honors the shared response byte budget', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('0123456789')) as typeof fetch;
  try {
    assert.equal(await ddgHtml('bounded', { maxBytes: 5 }), '01234');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('DuckDuckGo HTML search honors the shared request timeout', async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(signal.reason ?? new Error('search fetch aborted'));
        },
        { once: true },
      );
    })) as typeof fetch;
  try {
    await assert.rejects(ddgHtml('timed', { timeoutMs: 10 }));
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
