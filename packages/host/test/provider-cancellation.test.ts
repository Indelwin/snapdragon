import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anthropicProvider } from '../src/providers/anthropic.ts';
import { codexProvider } from '../src/providers/codex.ts';
import { openaiCompatibleProvider } from '../src/providers/openai-compatible.ts';
import { openaiResponsesProvider } from '../src/providers/openai-responses.ts';
import { Registry, type StreamingChatHandler } from '../src/registry.ts';
import { sseLines } from '../src/stream/sse.ts';

const request = {
  role: 'assistant',
  messages: [{ role: 'user' as const, content: 'hello' }],
};

const responseEvents = sse([
  {
    type: 'response.completed',
    response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } },
  },
]);

const providers: Array<{
  name: string;
  create: (fetch: typeof globalThis.fetch) => StreamingChatHandler;
}> = [
  {
    name: 'Anthropic',
    create: (fetch) =>
      anthropicProvider({
        apiKey: 'test-key',
        model: 'claude-test',
        fetch,
      }),
  },
  {
    name: 'OpenAI-compatible',
    create: (fetch) =>
      openaiCompatibleProvider({
        apiKey: 'test-key',
        model: 'gpt-test',
        fetch,
      }),
  },
  {
    name: 'OpenAI Responses',
    create: (fetch) =>
      openaiResponsesProvider({
        apiKey: 'test-key',
        model: 'gpt-test',
        fetch,
      }),
  },
  {
    name: 'Codex',
    create: (fetch) =>
      codexProvider({
        auth: async () => ({ accessToken: 'test-token' }),
        model: 'gpt-test',
        fetch,
      }),
  },
];

for (const providerCase of providers) {
  test(`${providerCase.name} forwards the stream signal to fetch`, async () => {
    const controller = new AbortController();
    let fetchSignal: AbortSignal | null | undefined;
    const provider = providerCase.create(async (_url, init) => {
      fetchSignal = init?.signal;
      return new Response(streamBody(providerCase.name));
    });

    await provider(request, {
      runId: 'run_signal',
      emit: () => undefined,
      signal: controller.signal,
    });

    assert.equal(fetchSignal, controller.signal);
  });
}

test('Registry forwards a local chat signal into stream context', async () => {
  const controller = new AbortController();
  let streamSignal: AbortSignal | undefined;
  const registry = new Registry().provideLlmChat(async (_request, context) => {
    streamSignal = context.signal;
    return { content: 'ok' };
  });

  await registry.chat('assistant', [], { signal: controller.signal });

  assert.equal(streamSignal, controller.signal);
});

test('SSE reader cancels the body when iteration exits early', async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      streamController.enqueue(new TextEncoder().encode('data: first\n\n'));
    },
    cancel() {
      canceled = true;
    },
  });

  for await (const payload of sseLines(body)) {
    assert.equal(payload, 'first');
    break;
  }

  assert.equal(canceled, true);
});

test('SSE reader cancels a pending read and rejects when aborted', async () => {
  const controller = new AbortController();
  let cancelReason: unknown;
  const body = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelReason = reason;
    },
  });
  const iterator = sseLines(body, controller.signal)[Symbol.asyncIterator]();
  const pending = iterator.next();

  controller.abort();

  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelReason, controller.signal.reason);
});

function streamBody(provider: string): string {
  if (provider === 'Anthropic') {
    return sse([
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 1 },
      },
    ]);
  }
  if (provider === 'OpenAI-compatible') {
    return `${sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }])}data: [DONE]\n\n`;
  }
  return responseEvents;
}

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}
