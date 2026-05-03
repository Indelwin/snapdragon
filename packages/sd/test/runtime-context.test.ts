import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProviderModelLimits, StreamingChatHandler } from '@snapdragon-ai/host';
import { defaultSdConfig, type SdConfig } from '../src/config.ts';
import type { SdProviderRuntime } from '../src/provider.ts';
import { contextOptions } from '../src/runtime-context.ts';

const noopHandler: StreamingChatHandler = async () => ({
  role: 'assistant',
  content: '',
  finish_reason: 'stop',
});

function providerWithLimits(
  limits: ProviderModelLimits | undefined,
  kind: SdProviderRuntime['kind'] = 'openai-codex',
): SdProviderRuntime {
  return {
    id: 'p',
    kind,
    model: 'm',
    handler: noopHandler,
    limits,
  };
}

test('contextOptions returns undefined when no agent context and no provider limits', () => {
  const config: SdConfig = { ...defaultSdConfig(), agent: undefined };
  assert.equal(contextOptions(config), undefined);
  assert.equal(contextOptions(config, providerWithLimits(undefined)), undefined);
});

test('contextOptions derives maxRequestTokens from provider context window when config omits it', () => {
  const config: SdConfig = { ...defaultSdConfig(), agent: undefined };
  const opts = contextOptions(
    config,
    providerWithLimits({ contextWindow: 200_000, effectiveContextWindowPercent: 90 }),
  );
  assert.ok(opts);
  assert.equal(opts?.maxRequestTokens, 180_000);
});

test('contextOptions defaults effectiveContextWindowPercent to 95 when unspecified', () => {
  const config: SdConfig = { ...defaultSdConfig(), agent: undefined };
  const opts = contextOptions(config, providerWithLimits({ contextWindow: 200_000 }));
  assert.equal(opts?.maxRequestTokens, 190_000);
});

test('contextOptions prefers explicit user max_request_tokens over derived value', () => {
  const config: SdConfig = {
    ...defaultSdConfig(),
    agent: { context: { max_request_tokens: 50_000 } },
  };
  const opts = contextOptions(
    config,
    providerWithLimits({ contextWindow: 1_000_000, effectiveContextWindowPercent: 95 }),
  );
  assert.equal(opts?.maxRequestTokens, 50_000);
});

test('contextOptions ignores zero/negative provider context windows', () => {
  const config: SdConfig = { ...defaultSdConfig(), agent: undefined };
  assert.equal(contextOptions(config, providerWithLimits({ contextWindow: 0 })), undefined);
  assert.equal(contextOptions(config, providerWithLimits({ contextWindow: -1 })), undefined);
});
