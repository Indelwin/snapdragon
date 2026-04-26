import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  normalizeProviderConfig,
  normalizeSessionConfig,
  normalizeToolsetsConfig,
} from '../src/index.ts';

test('config helpers normalize resolved runtime inputs without IO', () => {
  assert.deepEqual(
    normalizeToolsetsConfig({
      enabled: ['file', 'file', 'shell'],
      denied_tools: ['run_shell', 'run_shell'],
      sandbox_root: '/workspace',
    }),
    {
      enabled: ['file', 'shell'],
      disabled: [],
      allowedTools: undefined,
      deniedTools: ['run_shell'],
      sandboxRoot: '/workspace',
      options: {},
    },
  );
  assert.deepEqual(normalizeSessionConfig({}), { enabled: true });
  assert.equal(
    normalizeProviderConfig({ id: ' openai ', kind: 'openai', model: ' gpt ' }).id,
    'openai',
  );
});

test('provider config requires an id and model', () => {
  assert.throws(() => normalizeProviderConfig({ id: ' ', kind: 'custom', model: 'x' }));
  assert.throws(() => normalizeProviderConfig({ id: 'x', kind: 'custom', model: ' ' }));
});
