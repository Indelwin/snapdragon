import assert from 'node:assert/strict';
import test from 'node:test';
import { contentFilter } from '../src/index.js';

test('content filter chunks and ranks by query', async () => {
  const f = await contentFilter();
  const markdown =
    'Cats are independent animals with whiskers.\n\nDogs are loyal companion animals with paws.\n\nFish swim in water.';
  const chunks = f.chunkAndFilter(markdown, { query: 'dogs loyal', minChars: 5 });
  assert.equal(chunks[0]?.text, 'Dogs are loyal companion animals with paws.');
  assert.ok((chunks[0]?.score ?? 0) > 0);

  const best = f.bestChunk(markdown, 'cats');
  assert.equal(best?.text, 'Cats are independent animals with whiskers.');
});
