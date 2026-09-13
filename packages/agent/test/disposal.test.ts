import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgent } from '../src/index.js';

test('owned agent disposal reports cleanup failure after all toolsets finish', async () => {
  const calls: string[] = [];
  const agent = await createAgent({
    cwd: process.cwd(),
    provider: async () => ({ content: 'unused' }),
    tools: [
      {
        name: 'throws',
        title: 'Throws',
        description: 'throws',
        tools: [],
        dispose() {
          calls.push('throws');
          throw new Error('cleanup failed');
        },
      },
      {
        name: 'async',
        title: 'Async',
        description: 'async',
        tools: [],
        async dispose() {
          await Promise.resolve();
          calls.push('async');
        },
      },
    ],
  });
  const disposal = agent.dispose();
  assert.strictEqual(agent.dispose(), disposal);
  let failure: unknown;
  await assert.rejects(disposal, (error) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 1);
    failure = error;
    return true;
  });
  await assert.rejects(agent.dispose(), (error) => error === failure);
  assert.deepEqual(new Set(calls), new Set(['throws', 'async']));
  assert.deepEqual(agent.registry.list(), []);
  await assert.rejects(agent.prompt('after disposal'), /disposed/);
});
