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

test('tool registry disposal is idempotent and contains throwing toolsets', async () => {
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

  await Promise.all([registry.dispose(), registry.dispose()]);

  assert.deepEqual(new Set(disposed), new Set(['async', 'throwing']));
  assert.equal((await registry.invoke('missing', {})).isError, true);
  await assert.rejects(
    registry.register({ name: 'late', title: 'Late', description: 'late', tools: [] }),
    /disposed/,
  );
});
