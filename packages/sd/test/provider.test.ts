import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { makeSdProvider } from '../src/provider.ts';

test('makeSdProvider resolves mock without API credentials', () => {
  const config = configWithProvider('mock');
  const provider = makeSdProvider(config, {}, {});
  assert.equal(provider.id, 'mock');
  assert.equal(provider.kind, 'mock');
  assert.equal(provider.model, 'mock');
});

test('makeSdProvider resolves Anthropic from env var name', () => {
  const config = defaultSdConfig();
  const provider = makeSdProvider(config, {}, { ANTHROPIC_API_KEY: 'test-key' });
  assert.equal(provider.id, 'anthropic');
  assert.equal(provider.kind, 'anthropic');
  assert.equal(provider.model, 'claude-opus-4-7');
});

test('makeSdProvider errors with env var name but not secret value', () => {
  const config = defaultSdConfig();
  assert.throws(
    () => makeSdProvider(config, {}, {}),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /ANTHROPIC_API_KEY/);
      assert.doesNotMatch(error.message, /test-key/);
      return true;
    },
  );
});

test('makeSdProvider supports OpenAI Responses and compatible endpoints', () => {
  const config = defaultSdConfig();
  const openai = makeSdProvider(config, { provider: 'openai' }, { OPENAI_API_KEY: 'openai-key' });
  const compatible = makeSdProvider(
    config,
    { provider: 'openai-compatible', model: 'custom-model' },
    { OPENAI_API_KEY: 'compatible-key' },
  );

  assert.equal(openai.kind, 'openai');
  assert.equal(compatible.kind, 'openai-compatible');
  assert.equal(compatible.model, 'custom-model');
});

function configWithProvider(provider: string): SdConfig {
  return {
    ...defaultSdConfig(),
    default_provider: provider,
  };
}
