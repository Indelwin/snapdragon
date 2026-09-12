import assert from 'node:assert/strict';
import test from 'node:test';
import { extractor } from '../src/index.js';
import { WebtoolsResourceLimitError } from '../src/resource-limits.js';

const HTML = `
<html><head><title>Example Title</title><meta name="description" content="Example desc"></head>
<body><nav>Skip me</nav><main><h1>Example Title</h1><p>Hello <b>world</b>.</p><a href="/next">Next</a></main></body></html>
`;

test('extractor converts HTML to markdown and metadata', async () => {
  const x = await extractor();
  const r = x.extract(HTML);
  assert.equal(r.title, 'Example Title');
  assert.equal(r.description, 'Example desc');
  assert.match(r.markdown, /# Example Title/);
  assert.equal(r.links[0]?.href, '/next');
  assert.deepEqual(r.truncation, { markdown: false, metadata: false });
});

test('extractor reports markdown truncation without exceeding maxChars', async () => {
  const x = await extractor();
  const result = x.extract(`<main><p>${'content '.repeat(100)}</p></main>`, 80);
  assert.equal(result.truncation.markdown, true);
  assert.ok(Array.from(result.markdown).length <= 80);
  assert.match(result.markdown, /truncated/);
});

test('extractor rejects HTML above the validated input budget', async () => {
  const x = await extractor();
  assert.throws(
    () => x.detectJsOnly('x'.repeat(2_000_001)),
    (error) => error instanceof WebtoolsResourceLimitError && error.resource === 'HTML input bytes',
  );
});

test('extractor selector and JS-only helpers work', async () => {
  const x = await extractor();
  const selected = x.extractBySelector(HTML, 'main p');
  assert.equal(selected.matched_nodes, 1);
  assert.equal(selected.texts[0], 'Hello world .');

  assert.equal(
    x.detectJsOnly("<html><body><div id='root'></div><script src='/a.js'></script></body></html>"),
    true,
  );
});
