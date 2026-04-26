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
