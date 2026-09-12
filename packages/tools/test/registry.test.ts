import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defineTool, ToolRegistry } from '../src/index.ts';

test('tool registry filters by toolset and tool allow/deny lists', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  await registry.register({
    name: 'alpha',
    title: 'Alpha',
    description: 'alpha tools',
    tools: [
      defineTool({
        name: 'alpha_one',
        toolset: 'alpha',
        description: 'one',
        parameters: { type: 'object' },
        run: async () => ({ content: 'one' }),
      }),
    ],
  });
  await registry.register({
    name: 'beta',
    title: 'Beta',
    description: 'beta tools',
    tools: [
      defineTool({
        name: 'beta_one',
        toolset: 'beta',
        description: 'one',
        parameters: { type: 'object' },
        run: async () => ({ content: 'one' }),
      }),
    ],
  });

  registry.applyConfig({ enabled: ['alpha', 'beta'], deniedTools: ['beta_one'] });

  assert.deepEqual(
    registry.listDefinitions().map((tool) => tool.name),
    ['alpha_one'],
  );
  assert.equal((await registry.invoke('beta_one', {})).isError, true);
  assert.equal(registry.listToolsets().length, 2);
});

test('tool registry disposal finishes every owner and preserves aggregate failure idempotently', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  const disposed: string[] = [];
  await registry.register({
    name: 'throwing',
    title: 'Throwing',
    description: 'throws during cleanup',
    tools: [],
    dispose() {
      disposed.push('throwing');
      throw new Error('cleanup failed');
    },
  });
  await registry.register({
    name: 'async',
    title: 'Async',
    description: 'async cleanup',
    tools: [],
    async dispose() {
      await Promise.resolve();
      disposed.push('async');
    },
  });

  const disposal = registry.dispose();
  assert.strictEqual(registry.dispose(), disposal);
  let failure: unknown;
  await assert.rejects(disposal, (error) => {
    assert(error instanceof AggregateError);
    assert.equal(error.errors.length, 1);
    failure = error;
    return true;
  });
  await assert.rejects(registry.dispose(), (error) => error === failure);

  assert.deepEqual(new Set(disposed), new Set(['async', 'throwing']));
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.listToolsets(), []);
  assert.equal((await registry.invoke('missing', {})).isError, true);
  await assert.rejects(
    registry.register({ name: 'late', title: 'Late', description: 'late', tools: [] }),
    /disposed/,
  );
});

test('disposal joins pending registration and cannot resurrect registry maps', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  let release!: () => void;
  const checked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disposals = 0;
  const registration = registry.register({
    name: 'pending',
    title: 'Pending',
    description: 'pending check',
    tools: [
      defineTool({
        name: 'pending_tool',
        toolset: 'pending',
        description: 'pending',
        parameters: { type: 'object' },
        run: async () => ({ content: 'done' }),
      }),
    ],
    async check() {
      await checked;
      return { available: true };
    },
    dispose() {
      disposals++;
    },
  });
  const rejected = assert.rejects(registration, /disposed/);
  const disposal = registry.dispose();
  await Promise.resolve();
  assert.equal(disposals, 0, 'cleanup must wait for the pending check');
  release();
  await Promise.all([disposal, rejected]);
  assert.equal(disposals, 1);
  assert.deepEqual(registry.list(), []);
  assert.deepEqual(registry.listDefinitions(), []);
  assert.deepEqual(registry.listToolsets(), []);
  assert.equal(registry.describe('pending_tool'), undefined);
  await registry.dispose();
  assert.equal(disposals, 1);
});

test('a rejected pending check still disposes its owned toolset exactly once', async () => {
  const registry = new ToolRegistry({ cwd: process.cwd() });
  let rejectCheck!: (error: Error) => void;
  const checked = new Promise<never>((_, reject) => {
    rejectCheck = reject;
  });
  let disposals = 0;
  const toolset = {
    name: 'failed',
    title: 'Failed',
    description: 'failed',
    tools: [],
    check: () => checked,
    dispose() {
      disposals++;
    },
  };
  const registrations = [registry.register(toolset), registry.register(toolset)];
  const results = Promise.allSettled(registrations);
  const disposal = registry.dispose();
  rejectCheck(new Error('availability failed'));
  await disposal;
  assert((await results).every((result) => result.status === 'rejected'));
  assert.equal(disposals, 1);
  assert.deepEqual(registry.listToolsets(), []);
});
