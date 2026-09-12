import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ContextReadBudgetExceededError, SessionStore } from '@snapdragon-ai/session';
import { assembleProviderRequestMessages, estimateRequestTokens } from '../src/request-context.js';

test('preflight exhausts smaller fresh tails after a bounded read reports pressure', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'sd-preflight-read-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const session = new SessionStore({ root }).create('archive');
  for (let i = 0; i < 40; i++)
    session.appendMessage({ role: 'user', content: 'x'.repeat(128 * 1024) });
  session.appendMessage({ role: 'user', content: 'keep this prompt' });
  const messages = await assembleProviderRequestMessages({
    session,
    context: { enabled: true, freshTailCount: 40, maxRequestTokens: 120_000 },
    fallbackMessages: [],
    systemMessages: [],
    tools: [],
  });
  assert.equal(messages.at(-1)?.content, 'keep this prompt');
  assert(estimateRequestTokens(messages, []) <= 120_000);
});

test('preflight propagates an irreducible record read error without assembling fallback history', async () => {
  let compactions = 0;
  const error = new ContextReadBudgetExceededError('record', 1_048_576, 1);
  await assert.rejects(
    assembleProviderRequestMessages({
      session: {
        appendMessage() {},
        messages: () => [],
        assembleContext: () => [],
        compactContext() {
          compactions++;
          throw error;
        },
      },
      context: { enabled: true, freshTailCount: 32, maxRequestTokens: 120_000 },
      fallbackMessages: [{ role: 'user', content: 'must not substitute this' }],
      systemMessages: [],
      tools: [],
    }),
    (thrown) => thrown === error,
  );
  assert.equal(compactions, 1);
});

test('preflight surfaces bounded no-progress when no protected tail can fit', async () => {
  let compactions = 0;
  const error = new ContextReadBudgetExceededError('messages', 4_194_304);
  await assert.rejects(
    assembleProviderRequestMessages({
      session: {
        appendMessage() {},
        messages: () => [],
        assembleContext: () => [],
        compactContext() {
          compactions++;
          throw error;
        },
      },
      context: { enabled: true, freshTailCount: 4, maxRequestTokens: 120_000 },
      fallbackMessages: [],
      systemMessages: [],
      tools: [],
    }),
    (thrown) => thrown === error,
  );
  assert.equal(compactions, 3);
});
