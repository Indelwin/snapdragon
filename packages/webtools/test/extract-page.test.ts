import assert from 'node:assert/strict';
import test from 'node:test';
import { type WebExtractOptions, webExtract } from '../src/extract-page.js';
import { fetchPage } from '../src/http.js';

const encoder = new TextEncoder();

test('fetchPage truncates streaming bodies at maxBytes', async () => {
  const restore = mockFetch(
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('abcdef'));
          controller.enqueue(encoder.encode('ghijkl'));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/html' } },
    ),
  );
  try {
    const page = await fetchPage('https://example.com/large', { maxBytes: 8 });
    assert.equal(page.html, 'abcdefgh');
    assert.equal(page.status, 200);
    assert.equal(page.contentType, 'text/html');
  } finally {
    restore();
  }
});

test('webExtract uses an available Camofox client before static fetch', async () => {
  const restore = mockFetch(new Response('<html>unused</html>'));
  const calls: string[] = [];
  const camofox: NonNullable<WebExtractOptions['camofox']> = {
    available: async () => true,
    fetchPage: async (url) => {
      calls.push(url);
      return {
        url,
        finalUrl: url,
        status: 200,
        ok: true,
        contentType: 'text/html',
        html: '<html><body><main><h1>Camofox</h1><p>Rendered page.</p></main></body></html>',
        source: 'camofox',
      };
    },
  };
  try {
    const page = await webExtract('https://example.com/rendered', { camofox });
    assert.equal(page.source, 'camofox');
    assert.deepEqual(calls, ['https://example.com/rendered']);
    assert.match(page.markdown, /Rendered page/);
  } finally {
    restore();
  }
});

test('webExtract falls back to Jina for JS-only direct pages', async () => {
  const requested: string[] = [];
  const restore = mockFetch((url) => {
    requested.push(String(url));
    if (requested.length === 1) {
      return new Response(
        "<html><body><div id='root'></div><script src='/app.js'></script></body></html>",
      );
    }
    return new Response(
      '<html><body><main><h1>Reader</h1><p>Readable fallback.</p></main></body></html>',
    );
  });
  try {
    const page = await webExtract('https://example.com/app', {
      preferCamofox: false,
      maxChunks: 2,
    });
    assert.equal(page.source, 'jina');
    assert.match(page.markdown, /Readable fallback/);
    assert.equal(requested.length, 2);
    assert.match(requested[1] ?? '', /^https:\/\/r\.jina\.ai\/http:\/\/example\.com\/app/);
  } finally {
    restore();
  }
});

function mockFetch(response: Response | ((url: RequestInfo | URL) => Response)): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url) =>
    typeof response === 'function' ? response(url) : response) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}
