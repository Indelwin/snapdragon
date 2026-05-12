import assert from 'node:assert/strict';
import test from 'node:test';
import { extractor } from '../src/index.js';

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
