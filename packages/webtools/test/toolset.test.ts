import assert from 'node:assert/strict';
import test from 'node:test';
import { webtoolsToolset } from '../src/toolset.js';
import { withDisposable } from '../src/toolset-helpers.js';

test('webtools toolset disposal is awaitable and idempotent', async () => {
  const toolset = webtoolsToolset();
  const disposal = toolset.dispose();
  assert.equal(typeof disposal.then, 'function');
  await disposal;
  await toolset.dispose();
  assert.equal(toolset.crawlStore.diagnostics().disposed, true);
});

test('withDisposable awaits asynchronous resource disposal', async () => {
  const events: string[] = [];
  const result = await withDisposable(
    async () => ({
      async dispose() {
        await Promise.resolve();
        events.push('disposed');
      },
    }),
    async () => {
      events.push('used');
      return 42;
    },
  );
  assert.equal(result, 42);
  assert.deepEqual(events, ['used', 'disposed']);
});
