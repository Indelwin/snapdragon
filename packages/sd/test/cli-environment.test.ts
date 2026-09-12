import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareCliEnvironment } from '../src/cli-environment.js';

test('CLI rendering defaults to production before loading React', () => {
  const env: NodeJS.ProcessEnv = {};
  prepareCliEnvironment(env);
  assert.equal(env.NODE_ENV, 'production');
});

test('an explicitly selected development environment is preserved', () => {
  const env = { NODE_ENV: 'development' };
  prepareCliEnvironment(env);
  assert.equal(env.NODE_ENV, 'development');
});

test('importing CLI environment helpers does not change the embedding process', async () => {
  const before = process.env.NODE_ENV;
  await import('../src/cli.js');
  assert.equal(process.env.NODE_ENV, before);
});
