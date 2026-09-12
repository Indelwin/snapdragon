import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { Message } from '@snapdragon-ai/host';
import { createAgent } from '../src/index.ts';
import { type ProviderRequestState, sendProviderRequest } from '../src/provider-request.ts';

const userMessage: Message = { role: 'user', content: 'hello' };
const replacement = { visible: userMessage, request: userMessage };

test('provider request forwards its signal and aborts a pending request', async () => {
  const controller = new AbortController();
  const started = deferred<void>();
  let providerSignal: AbortSignal | undefined;
  const state = providerState(async (_request, context) => {
    providerSignal = context.signal;
    started.resolve();
    return new Promise((_resolve, reject) => {
      const abort = () => reject(context.signal?.reason);
      if (context.signal?.aborted) abort();
      else context.signal?.addEventListener('abort', abort, { once: true });
    });
  });

  const pending = sendProviderRequest(state, replacement, [], 'run_pending', controller.signal);
  await started.promise;
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();

  await rejected;
  assert.equal(providerSignal, controller.signal);
});

test('aborting a provider retry delay rejects immediately without another attempt', async () => {
  const controller = new AbortController();
  const firstAttempt = deferred<void>();
  let attempts = 0;
  const state = providerState(async () => {
    attempts += 1;
    firstAttempt.resolve();
    if (attempts === 1) throw new Error('openai 503: unavailable');
    return { content: 'unexpected retry' };
  });

  const pending = sendProviderRequest(state, replacement, [], 'run_retry', controller.signal);
  await firstAttempt.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();

  await rejected;
  assert.equal(attempts, 1);
});

test('agent disposal aborts an active provider and waits for prompt cleanup', async () => {
  const providerStarted = deferred<void>();
  const providerAborted = deferred<void>();
  const releaseProvider = deferred<void>();
  let providerSignal: AbortSignal | undefined;
  const agent = await createAgent({
    provider: async (_request, context) => {
      providerSignal = context.signal;
      providerStarted.resolve();
      return new Promise((_resolve, reject) => {
        const abort = () => {
          providerAborted.resolve();
          void releaseProvider.promise.then(() => reject(context.signal?.reason));
        };
        if (context.signal?.aborted) abort();
        else context.signal?.addEventListener('abort', abort, { once: true });
      });
    },
  });

  const prompt = agent.prompt('wait for cancellation');
  await providerStarted.promise;
  const rejected = assert.rejects(prompt, { name: 'AbortError' });
  let disposed = false;
  const disposal = agent.dispose().then(() => {
    disposed = true;
  });

  await providerAborted.promise;
  await Promise.resolve();
  assert.equal(providerSignal?.aborted, true);
  assert.equal(disposed, false);

  releaseProvider.resolve();
  await Promise.all([rejected, disposal]);
  assert.equal(disposed, true);
});

function providerState(provider: ProviderRequestState['provider']): ProviderRequestState {
  return {
    provider,
    listeners: new Set(),
    fallbackMessages: [],
    systemPrompt: '',
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
