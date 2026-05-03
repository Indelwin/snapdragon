import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import { configuredModelsForProvider, listSdProviders, makeSdProvider } from '../src/provider.ts';

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

test('makeSdProvider supports OpenAI Codex without API key env vars', () => {
  const config = defaultSdConfig();
  const provider = makeSdProvider(config, { provider: 'openai-codex' }, {});
  assert.equal(provider.kind, 'openai-codex');
  assert.equal(provider.model, 'gpt-5.5');
});

test('makeSdProvider exposes per-model limits for openai-codex', () => {
  const config = defaultSdConfig();
  const provider = makeSdProvider(config, { provider: 'openai-codex' }, {});
  assert.ok(provider.limits, 'codex provider should expose limits');
  assert.equal(provider.limits?.contextWindow, 272_000);
  assert.equal(provider.limits?.effectiveContextWindowPercent, 95);
});

test('makeSdProvider leaves limits undefined for providers without per-model data', () => {
  const config = defaultSdConfig();
  const mock = makeSdProvider(config, { provider: 'mock' }, {});
  assert.equal(mock.limits, undefined);
});

test('provider summaries expose configured models and active provider', () => {
  const config = defaultSdConfig();
  const providers = listSdProviders(config, 'openai-codex');
  const codex = providers.find((provider) => provider.id === 'openai-codex');

  assert.equal(codex?.active, true);
  assert.equal(codex?.model, 'gpt-5.5');
  assert.ok(codex?.models.includes('gpt-5.5'));
  assert.deepEqual(configuredModelsForProvider(config, 'mock'), ['mock']);
});

function configWithProvider(provider: string): SdConfig {
  return {
    ...defaultSdConfig(),
    default_provider: provider,
  };
}
