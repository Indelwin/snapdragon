import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  listAnthropicModels,
  listCodexModels,
  listOpenAICompatibleModels,
} from '../src/model-discovery.ts';
import { anthropicBody } from '../src/providers/anthropic.ts';
import { readAnthropicStream } from '../src/providers/anthropic-stream.ts';
import { codexProvider } from '../src/providers/codex.ts';
import { codexInputItems } from '../src/providers/codex-input.ts';
import { openAIChatBody } from '../src/providers/openai-compatible.ts';
import { openAIResponsesBody } from '../src/providers/openai-responses-format.ts';

test('OpenAI Responses maps text and image content blocks', () => {
  const { body } = openAIResponsesBody('gpt-test', {
    role: 'assistant',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          {
            type: 'image',
            source: { type: 'url', url: 'https://example.test/a.png' },
            detail: 'high',
          },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
          { type: 'image', source: { type: 'file', file_id: 'file_123' } },
        ],
      },
    ],
    tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
    reasoning: { enabled: true, effort: 'high' },
  });

  const input = body.input as Array<{ content: Array<Record<string, unknown>> }>;
  assert.equal(input[0].content[1].type, 'input_image');
  assert.equal(input[0].content[1].image_url, 'https://example.test/a.png');
  assert.equal(input[0].content[2].image_url, 'data:image/png;base64,abc');
  assert.equal(input[0].content[3].file_id, 'file_123');
  assert.deepEqual(body.reasoning, { effort: 'high', summary: 'auto' });
});

test('OpenAI Responses maps native image generation tools', () => {
  const { body } = openAIResponsesBody('gpt-5.5', {
    role: 'assistant',
    messages: [{ role: 'user', content: 'draw this' }],
    native_tools: [
      {
        type: 'image_generation',
        model: 'gpt-image-2',
        quality: 'high',
        partial_images: 2,
      },
    ],
  });

  assert.deepEqual(body.tools, [
    {
      type: 'image_generation',
      model: 'gpt-image-2',
      quality: 'high',
      partial_images: 2,
    },
  ]);
});

test('OpenAI-compatible maps image blocks to image_url content parts', () => {
  const body = openAIChatBody('gpt-test', {
    role: 'assistant',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
        ],
      },
    ],
  });

  const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
  assert.equal(messages[0].content[1].type, 'image_url');
  assert.deepEqual(messages[0].content[1].image_url, { url: 'https://example.test/a.png' });
});

test('Anthropic maps images and thinking/tool-use round trips', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'please read it' },
        {
          role: 'assistant',
          content: 'calling',
          thinking: [{ text: 'signed', signature: 'sig_1' }],
          tool_calls: [{ id: 'toolu_1', name: 'read', args_json: '{"path":"README.md"}' }],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: 'README contents' },
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
            { type: 'text', text: 'what is this?' },
          ],
        },
      ],
    },
  );

  const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
  // user("please read it") -> assistant(thinking + text + tool_use) -> user(tool_result + image + text).
  assert.equal(messages[1].content[0].type, 'thinking');
  assert.equal(messages[1].content[2].type, 'tool_use');
  assert.equal(messages[2].content[0].type, 'tool_result');
  assert.deepEqual(messages[2].content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'abc' },
  });
  assert.equal(messages[2].content[2].type, 'text');
});

test('Anthropic drops unsigned thinking when replaying assistant tool history', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'please inspect' },
        {
          role: 'assistant',
          content: 'calling',
          thinking: [{ text: 'unsigned reasoning from another provider' }],
          tool_calls: [{ id: 'toolu_1', name: 'read', args_json: '{}' }],
        },
        { role: 'tool', tool_call_id: 'toolu_1', content: 'done' },
      ],
    },
  );

  const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
  assert.equal(
    messages[1].content.some((block) => block.type === 'thinking'),
    false,
  );
  assert.equal(messages[1].content[0].type, 'text');
  assert.equal(messages[1].content[1].type, 'tool_use');
});

test('Anthropic accepts cross-provider history with unsigned reasoning and tool calls', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'continue this codex session' },
        {
          role: 'assistant',
          content: '',
          thinking: [{ text: 'codex reasoning summary without an Anthropic signature' }],
          tool_calls: [{ id: 'call_1', name: 'run_shell', args_json: '{"command":"pwd"}' }],
        },
      ],
    },
  );

  const messages = body.messages as Array<{ content: Array<Record<string, unknown>> }>;
  assert.equal(
    messages[1].content.some((block) => block.type === 'thinking'),
    false,
  );
  assert.equal(messages[1].content[0].type, 'tool_use');
  assert.equal(messages[2].content[0].type, 'tool_result');
});

test('Anthropic synthesizes a tool_result stub when one is missing', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            { id: 'toolu_a', name: 'shell', args_json: '{"command":"echo a"}' },
            { id: 'toolu_b', name: 'shell', args_json: '{"command":"echo b"}' },
          ],
        },
        // Only one of the two tool calls has a corresponding tool message.
        { role: 'tool', tool_call_id: 'toolu_a', content: 'a-result' },
        { role: 'user', content: 'follow-up' },
      ],
    },
  );

  const messages = body.messages as Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  // user(hi) -> assistant(tool_use x2) -> user(tool_result a + stub b + "follow-up")
  assert.equal(messages.length, 3);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[2].role, 'user');
  const ids = messages[2].content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id);
  assert.deepEqual(ids, ['toolu_a', 'toolu_b']);
  const stub = messages[2].content.find(
    (b) => b.type === 'tool_result' && b.tool_use_id === 'toolu_b',
  ) as { content: string };
  assert.match(stub.content, /tool result missing/);
  // The trailing user("follow-up") was folded into the same user message as
  // the tool_results so roles still alternate.
  assert.ok(messages[2].content.some((b) => b.type === 'text' && b.text === 'follow-up'));
});

test('Anthropic folds consecutive user messages into one', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'user', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    },
  );
  const messages = body.messages as Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  const texts = messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
  assert.deepEqual(texts, ['first', 'second', 'third']);
});

test('Anthropic drops orphan tool messages with no matching tool_use', () => {
  const body = anthropicBody(
    { model: 'claude-test' },
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'tool', tool_call_id: 'toolu_orphan', content: 'should be dropped' },
        { role: 'user', content: 'real follow-up' },
      ],
    },
  );
  const messages = body.messages as Array<{
    role: string;
    content: Array<Record<string, unknown>>;
  }>;
  // The orphan tool message must be dropped, leaving the two user messages
  // which then get folded.
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  const hasOrphan = messages[0].content.some(
    (b) => b.type === 'tool_result' && b.tool_use_id === 'toolu_orphan',
  );
  assert.equal(hasOrphan, false);
});

test('Anthropic maps reasoning to adaptive thinking on supported Claude models', () => {
  const body = anthropicBody(
    { model: 'claude-opus-4-7' },
    {
      role: 'assistant',
      messages: [{ role: 'user', content: 'think' }],
      reasoning: { enabled: true, effort: 'xhigh', budget_tokens: 32000 },
    },
  );

  assert.deepEqual(body.thinking, { type: 'adaptive', display: 'summarized' });
  assert.deepEqual(body.output_config, { effort: 'xhigh' });
});

test('Anthropic keeps manual thinking for older Claude models', () => {
  const body = anthropicBody(
    { model: 'claude-opus-4-5-20251101' },
    {
      role: 'assistant',
      messages: [{ role: 'user', content: 'think' }],
      reasoning: { enabled: true, effort: 'high', budget_tokens: 32000 },
    },
  );

  assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 32000 });
  assert.equal(body.output_config, undefined);
});

test('Codex provider streams text, reasoning, tool calls, and usage', async () => {
  const seen: unknown[] = [];
  const provider = codexProvider({
    model: 'gpt-test',
    auth: { accessToken: 'test-token', accountId: 'acct_1' },
    defaultMaxTokens: 2048,
    fetch: async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(
        sse([
          { type: 'response.output_text.delta', delta: 'hello' },
          { type: 'response.reasoning_summary_text.delta', delta: 'think' },
          {
            type: 'response.output_item.added',
            item: { type: 'function_call', call_id: 'call_1', name: 'read' },
          },
          { type: 'response.function_call_arguments.delta', call_id: 'call_1', delta: '{"path"' },
          {
            type: 'response.function_call_arguments.delta',
            call_id: 'call_1',
            delta: ':"README.md"}',
          },
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 2 } },
          },
        ]),
      );
    },
  });

  const response = await provider(
    { role: 'assistant', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1024 },
    { runId: 'run_1', emit: () => undefined },
  );

  assert.equal(seen.length, 1);
  assert.equal('max_output_tokens' in (seen[0] as Record<string, unknown>), false);
  assert.equal(response.content, 'hello');
  assert.equal(response.tokens_in, 1);
  assert.deepEqual(response.tool_calls, [
    { id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' },
  ]);
});

test('Codex input repair completes assistant message records', () => {
  const input = codexInputItems([
    { type: 'function_call', name: 'read_file' },
    {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'input_text', text: 'prior answer' }],
    },
  ]) as Array<Record<string, unknown>>;

  assert.deepEqual(input[0], { type: 'function_call', name: 'read_file' });
  assert.equal(input[1].id, 'msg_1');
  assert.equal(input[1].status, 'completed');
  assert.deepEqual(input[1].content, [
    { type: 'output_text', text: 'prior answer', annotations: [] },
  ]);
});

test('Codex input repair preserves existing ids, status, annotations, and non-array content', () => {
  const input = codexInputItems([
    {
      type: 'message',
      role: 'assistant',
      id: 'msg_existing',
      status: 'in_progress',
      content: [{ type: 'input_text', text: 'prior answer', annotations: [{ type: 'note' }] }],
    },
    { type: 'message', role: 'assistant', content: 'plain text' },
    null,
  ]) as Array<Record<string, unknown> | null>;

  assert.equal(input[0]?.id, 'msg_existing');
  assert.equal(input[0]?.status, 'in_progress');
  assert.deepEqual(input[0]?.content, [
    { type: 'output_text', text: 'prior answer', annotations: [{ type: 'note' }] },
  ]);
  assert.equal(input[1]?.content, 'plain text');
  assert.equal(input[2], null);
});

test('Codex provider maps assistant history text to output_text content blocks', async () => {
  let seen: Record<string, unknown> | undefined;
  const provider = codexProvider({
    model: 'gpt-test',
    auth: { accessToken: 'test-token' },
    fetch: async (_url, init) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        sse([
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } },
          },
        ]),
      );
    },
  });

  await provider(
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'prior answer' },
        { role: 'user', content: 'next' },
      ],
    },
    { runId: 'run_1', emit: () => undefined },
  );

  const input = seen?.input as Array<{ role?: string; content?: Array<Record<string, unknown>> }>;
  assert.equal(input[0].content?.[0]?.type, 'input_text');
  assert.equal(input[1].role, 'assistant');
  assert.equal(input[1].content?.[0]?.type, 'output_text');
  assert.deepEqual(input[1].content?.[0]?.annotations, []);
  assert.equal(input[2].content?.[0]?.type, 'input_text');
});

test('Codex provider repairs missing tool outputs from interrupted history', async () => {
  let seen: Record<string, unknown> | undefined;
  const provider = codexProvider({
    model: 'gpt-test',
    auth: { accessToken: 'test-token' },
    fetch: async (_url, init) => {
      seen = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        sse([
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 } },
          },
        ]),
      );
    },
  });

  await provider(
    {
      role: 'assistant',
      messages: [
        { role: 'user', content: 'please read this' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'toolu_missing', name: 'read', args_json: '{"path":"README.md"}' }],
        },
        { role: 'user', content: 'carry on' },
      ],
    },
    { runId: 'run_1', emit: () => undefined },
  );

  const input = seen?.input as Array<Record<string, unknown>>;
  const callIndex = input.findIndex((item) => item.type === 'function_call');
  assert.ok(callIndex >= 0);
  assert.deepEqual(input[callIndex + 1], {
    type: 'function_call_output',
    call_id: 'toolu_missing',
    output: '[unknown error, tool output missing]',
  });
});

test('Codex provider forwards native image generation and captures generated images', async () => {
  const seen: unknown[] = [];
  const events: unknown[] = [];
  const provider = codexProvider({
    model: 'gpt-5.5',
    auth: { accessToken: 'test-token', accountId: 'acct_1' },
    fetch: async (_url, init) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(
        sse([
          {
            type: 'response.output_item.done',
            item: { type: 'image_generation_call', id: 'ig_1', result: 'abc123' },
          },
          {
            type: 'response.completed',
            response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 4 } },
          },
        ]),
      );
    },
  });

  const response = await provider(
    {
      role: 'assistant',
      messages: [{ role: 'user', content: 'make an image' }],
      native_tools: [{ type: 'image_generation', model: 'gpt-image-2' }],
    },
    { runId: 'run_1', emit: (event) => events.push(event) },
  );

  assert.deepEqual((seen[0] as { tools: unknown[] }).tools, [
    { type: 'image_generation', model: 'gpt-image-2' },
  ]);
  assert.deepEqual(response.generated_images, [{ id: 'ig_1', result: 'abc123' }]);
  assert.ok(events.some((event) => (event as { kind?: string }).kind === 'image_generation'));
});

test('model discovery supports static Codex models and OpenAI-compatible /models', async () => {
  const codexModels = listCodexModels();
  assert.equal(codexModels[0].id, 'gpt-5.5');
  assert.deepEqual(codexModels[0].limits, {
    contextWindow: 272_000,
    maxContextWindow: 272_000,
    effectiveContextWindowPercent: 95,
  });
  assert.deepEqual(codexModels.find((model) => model.id === 'gpt-5.3-codex-spark')?.limits, {
    contextWindow: 128_000,
    maxContextWindow: 128_000,
    effectiveContextWindowPercent: 95,
  });

  const models = await listOpenAICompatibleModels({
    apiKey: 'test-key',
    baseUrl: 'https://example.test/v1',
    fetch: async (url, init) => {
      assert.equal(url, 'https://example.test/v1/models');
      assert.equal((init?.headers as Record<string, string>).authorization, 'Bearer test-key');
      return Response.json({
        data: [
          { id: 'old', created: 1 },
          { id: 'new', created: 2 },
        ],
      });
    },
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['new', 'old'],
  );
});

test('Anthropic model discovery uses the Anthropic API base URL', async () => {
  const models = await listAnthropicModels({
    apiKey: 'test-key',
    fetch: async (url, init) => {
      assert.equal(url, 'https://api.anthropic.com/v1/models');
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers['x-api-key'], 'test-key');
      assert.equal(headers['anthropic-version'], '2023-06-01');
      return Response.json({
        data: [
          { id: 'claude-test', display_name: 'Claude Test', created_at: '2026-01-01T00:00:00Z' },
        ],
      });
    },
  });

  assert.deepEqual(
    models.map((model) => model.id),
    ['claude-test'],
  );
});

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

test('Anthropic stream throws when an SSE error event arrives mid-stream', async () => {
  const sseText = sse([
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Anthropic is currently overloaded' },
    },
  ]);
  const body = streamFromString(sseText);
  await assert.rejects(
    () =>
      readAnthropicStream(body, {
        runId: 'r',
        emit: () => undefined,
      }),
    /overloaded_error.*currently overloaded/,
  );
});

test('Anthropic stream throws when the stream ends without a stop reason', async () => {
  // No `message_delta` event at all — simulates a connection drop
  // mid-stream after some text has been produced.
  const sseText = sse([
    { type: 'message_start', message: { usage: { input_tokens: 5 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
    { type: 'content_block_stop', index: 0 },
  ]);
  const body = streamFromString(sseText);
  await assert.rejects(
    () =>
      readAnthropicStream(body, {
        runId: 'r',
        emit: () => undefined,
      }),
    /stream ended without a stop reason/,
  );
});

function streamFromString(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}
