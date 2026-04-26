import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anthropicBody } from '../src/providers/anthropic.ts';
import { codexProvider } from '../src/providers/codex.ts';
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
        {
          role: 'assistant',
          content: 'calling',
          thinking: [{ text: 'signed', signature: 'sig_1' }],
          tool_calls: [{ id: 'toolu_1', name: 'read', args_json: '{"path":"README.md"}' }],
        },
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
  assert.equal(messages[0].content[0].type, 'thinking');
  assert.equal(messages[0].content[2].type, 'tool_use');
  assert.deepEqual(messages[1].content[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'abc' },
  });
});

test('Codex provider streams text, reasoning, tool calls, and usage', async () => {
  const seen: unknown[] = [];
  const provider = codexProvider({
    model: 'gpt-test',
    auth: { accessToken: 'test-token', accountId: 'acct_1' },
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
    { role: 'assistant', messages: [{ role: 'user', content: 'hi' }] },
    { runId: 'run_1', emit: () => undefined },
  );

  assert.equal(seen.length, 1);
  assert.equal(response.content, 'hello');
  assert.equal(response.tokens_in, 1);
  assert.deepEqual(response.tool_calls, [
    { id: 'call_1', name: 'read', args_json: '{"path":"README.md"}' },
  ]);
});

function sse(events: Array<Record<string, unknown>>): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}
