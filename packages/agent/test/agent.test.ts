import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mockProvider } from '@snapdragon-ai/host';
import { estimateMessagesTokens, SessionStore } from '@snapdragon-ai/session';
import { createAgent, createCodingReplAgent } from '../src/index.ts';
import { transientProviderRetryDelayMs } from '../src/provider-retry.ts';
import { parseToolArgs } from '../src/tool-args.ts';

test('coding repl agent can call the REPL tool and continue', async () => {
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        name: 'repl_eval',
        args_json: JSON.stringify({ code: 'sdk.list().map((tool) => tool.name)' }),
      },
    ],
  });
  mock.enqueue('done');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });
  const response = await agent.prompt('List your tools');

  assert.equal(response.content, 'done');
  assert.ok(
    agent.messages.some(
      (message) => message.role === 'tool' && message.content.includes('repl_eval'),
    ),
  );
});

test('agent accepts multimodal content blocks', async () => {
  const mock = mockProvider();
  mock.enqueue('seen');
  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });

  await agent.prompt([
    { type: 'text', text: 'describe' },
    { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
  ]);

  const user = mock.history()[0].messages.find((message) => message.role === 'user');
  assert.deepEqual(user?.content, [
    { type: 'text', text: 'describe' },
    { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
  ]);
});

test('agent forwards provider stream events and reasoning requests', async () => {
  const mock = mockProvider({ chunkSize: 2 });
  mock.enqueue('seen');
  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
    reasoning: { enabled: true, effort: 'high' },
  });
  const streamEvents: string[] = [];
  agent.subscribe((event) => {
    if (event.type === 'provider_event') streamEvents.push(event.event.kind);
  });

  await agent.prompt('stream this');

  assert.deepEqual(mock.history()[0].reasoning, { enabled: true, effort: 'high' });
  assert.ok(streamEvents.includes('started'));
  assert.ok(streamEvents.includes('text'));
  assert.ok(streamEvents.includes('done'));
});

test('setProvider updates provider-specific runtime options', async () => {
  const initial = mockProvider();
  const seen: Array<{ max_tokens?: number }> = [];
  const agent = await createAgent({
    provider: initial.handler,
    cwd: process.cwd(),
    systemPrompt: '',
    maxTokens: 20,
  });

  agent.setProvider(
    async (request) => {
      seen.push({ max_tokens: request.max_tokens });
      return { content: 'switched' };
    },
    { maxTokens: 5 },
  );

  await agent.prompt('use switched provider');

  assert.deepEqual(seen, [{ max_tokens: 5 }]);
});

test('agent persists user, assistant, and tool messages into a session', async () => {
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        name: 'repl_eval',
        args_json: JSON.stringify({ code: '"ok"' }),
      },
    ],
  });
  mock.enqueue('done');
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_session');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
    session,
  });
  await agent.prompt('persist this');

  assert.deepEqual(
    session.messages().map((message) => message.role),
    ['user', 'assistant', 'tool', 'assistant'],
  );
});

test('agent persists run lifecycle metadata into a session', async () => {
  const mock = mockProvider();
  mock.enqueue('done');
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_run_meta');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
    session,
  });
  await agent.prompt('persist run metadata', { runId: 'run_test' });

  const runRecords = session
    .records()
    .filter((record) => record.type === 'session_meta')
    .map((record) => record.meta.run as { id?: string; status?: string } | undefined)
    .filter((run): run is { id?: string; status?: string } => run !== undefined);
  assert.deepEqual(
    runRecords.map((run) => [run.id, run.status]),
    [
      ['run_test', 'started'],
      ['run_test', 'finished'],
    ],
  );
});

test('agent persists run error metadata when a provider fails after tool results', async () => {
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        name: 'repl_eval',
        args_json: JSON.stringify({ code: '"ok"' }),
      },
    ],
  });
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_run_error');
  const agent = await createCodingReplAgent({
    provider: async (request, context) => {
      if (request.messages.some((message) => message.role === 'tool')) {
        throw new Error('provider died after tool output');
      }
      return mock.handler(request, context);
    },
    cwd: process.cwd(),
    session,
  });

  await assert.rejects(() => agent.prompt('trigger tool then fail', { runId: 'run_error' }));

  const runRecords = session
    .records()
    .filter((record) => record.type === 'session_meta')
    .map((record) => record.meta.run as { id?: string; status?: string; error?: string })
    .filter((run) => run?.id === 'run_error');
  assert.equal(runRecords.at(-1)?.status, 'error');
  assert.match(runRecords.at(-1)?.error ?? '', /provider died after tool output/);
});

test('agent has no default tool-turn cap', async () => {
  const mock = mockProvider();
  for (let index = 0; index < 35; index += 1) {
    mock.enqueueResponse({
      content: '',
      tool_calls: [
        {
          id: `call_${index}`,
          name: 'repl_eval',
          args_json: JSON.stringify({ code: JSON.stringify(index) }),
        },
      ],
    });
  }
  mock.enqueue('done');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });
  const response = await agent.prompt('keep going');

  assert.equal(response.content, 'done');
  assert.equal(agent.messages.filter((message) => message.role === 'tool').length, 35);
});

test('agent truncates oversized tool results before they enter provider history', async () => {
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    tool_calls: [
      {
        id: 'call_1',
        name: 'repl_eval',
        args_json: JSON.stringify({ code: JSON.stringify('x'.repeat(200)) }),
      },
    ],
  });
  mock.enqueue('done');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
    maxToolResultBytes: 40,
  });
  await agent.prompt('truncate this');

  const toolMessage = agent.messages.find((message) => message.role === 'tool');
  assert.match(String(toolMessage?.content), /tool result truncated to 40 bytes/);
  assert.ok(Buffer.byteLength(String(toolMessage?.content ?? ''), 'utf8') < 100);
});

test('agent sends compacted session context when context windowing is enabled', async () => {
  const mock = mockProvider();
  mock.enqueue('done');
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_context');
  for (let index = 0; index < 8; index += 1) {
    session.appendMessage({
      role: 'user',
      content: `old message ${index + 1} ${'x'.repeat(140)}`,
    });
  }
  const requestInput = [{ type: 'text' as const, text: 'visible with injected context' }];

  const agent = await createAgent({
    provider: mock.handler,
    cwd: process.cwd(),
    session,
    systemPrompt: '',
    context: {
      enabled: true,
      freshTailCount: 2,
      chunkTargetTokens: 100,
      summaryTargetTokens: 12,
      minChunkMessages: 2,
      maxRequestTokens: 40,
    },
  });
  await agent.prompt('visible', { requestInput });

  const providerMessages = mock.history()[0].messages;
  assert.match(
    String(providerMessages[0].content),
    /Context summary for earlier canonical messages/,
  );
  assert.equal(
    providerMessages.some(
      (message) =>
        message.role === 'user' &&
        typeof message.content === 'string' &&
        message.content.startsWith('old message 1'),
    ),
    false,
  );
  assert.deepEqual(providerMessages.at(-1)?.content, requestInput);
  assert.ok(session.contextChunks().length > 0);
});

test('agent shrinks the fresh tail when the assembled request still exceeds budget', async () => {
  const seen: unknown[] = [];
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_context_tail');
  for (let index = 0; index < 6; index += 1) {
    session.appendMessage({
      role: 'user',
      content: `old tail ${index + 1} ${'x'.repeat(2_000)}`,
    });
  }

  const agent = await createAgent({
    provider: async (request) => {
      seen.push(request.messages);
      return { content: 'done' };
    },
    cwd: process.cwd(),
    session,
    systemPrompt: '',
    context: {
      enabled: true,
      freshTailCount: 6,
      chunkTargetTokens: 200,
      summaryTargetTokens: 20,
      maxRequestTokens: 600,
    },
  });
  await agent.prompt('fit this request');

  const messages = seen[0] as Parameters<typeof estimateMessagesTokens>[0];
  assert.ok(estimateMessagesTokens(messages) <= 600);
  assert.equal(
    messages.some((message) => String(message.content).startsWith('old tail')),
    false,
  );
  assert.ok(session.contextChunks().length > 0);
});

test('agent retries context-window provider errors with stronger compaction pressure', async () => {
  const tokenCounts: number[] = [];
  const store = new SessionStore({ root: mkdtempSync(join(tmpdir(), 'snapdragon-agent-')) });
  const session = store.create('agent_context_retry');
  for (let index = 0; index < 8; index += 1) {
    session.appendMessage({
      role: 'user',
      content: `old retry ${index + 1} ${'x'.repeat(2_000)}`,
    });
  }

  const agent = await createAgent({
    provider: async (request) => {
      tokenCounts.push(estimateMessagesTokens(request.messages));
      if (tokenCounts.length === 1) {
        throw new Error('Your input exceeds the context window of this model.');
      }
      return { content: 'done' };
    },
    cwd: process.cwd(),
    session,
    systemPrompt: '',
    context: {
      enabled: true,
      freshTailCount: 8,
      chunkTargetTokens: 200,
      summaryTargetTokens: 20,
      minChunkMessages: 1,
      maxRequestTokens: 10_000,
    },
  });
  await agent.prompt('retry with pressure');

  assert.equal(tokenCounts.length, 2);
  assert.ok(tokenCounts[1] < tokenCounts[0]);
});

test('transient provider errors are classified for retry', () => {
  assert.equal(transientProviderRetryDelayMs(new Error('anthropic 429: rate limit'), 0), 2_000);
  assert.equal(transientProviderRetryDelayMs(new Error('openai 503: unavailable'), 1), 5_000);
  assert.equal(transientProviderRetryDelayMs(new Error('openai 400: bad request'), 0), undefined);
  assert.equal(transientProviderRetryDelayMs(new Error('fetch failed'), 5), undefined);
});

test('parseToolArgs accepts empty, valid JSON, and invalid JSON', () => {
  assert.deepEqual(parseToolArgs(''), {});
  assert.deepEqual(parseToolArgs('  \n '), {});
  assert.deepEqual(parseToolArgs('{"path":"README.md"}'), { path: 'README.md' });
  assert.deepEqual(parseToolArgs('[1,2]'), [1, 2]);
  assert.deepEqual(parseToolArgs('not json'), { raw: 'not json' });
});

test('agent emits a provider error event when content is empty with no tool calls', async () => {
  const mock = mockProvider();
  // Degenerate response: no text, no tool calls. This is the failure
  // mode we used to silently render as `(empty)` in the UI.
  mock.enqueueResponse({ content: '', finish_reason: 'end_turn' });

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });
  const events: Array<{ kind: string; message?: string }> = [];
  agent.subscribe((event) => {
    if (event.type === 'provider_event' && event.event.kind === 'error') {
      events.push({ kind: event.event.kind, message: event.event.message });
    }
  });

  const response = await agent.prompt('hi');
  assert.equal(response.content, '');
  assert.equal(events.length, 1);
  assert.match(events[0].message ?? '', /no content.*finish_reason=end_turn/);
});

test('agent emits a provider error when content is empty even if thinking blocks are present', async () => {
  // This is the regression case for the `(empty)` row that kept
  // appearing for the user with reasoning enabled by default — the
  // model produced thinking but bailed before generating text, and
  // the previous heuristic excluded that path from the error event.
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    finish_reason: 'end_turn',
    thinking: [{ text: 'okay so the user wants...' }, { text: '...and I think...' }],
  });

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });
  const messages: string[] = [];
  agent.subscribe((event) => {
    if (event.type === 'provider_event' && event.event.kind === 'error') {
      messages.push(event.event.message);
    }
  });

  await agent.prompt('hi');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /only reasoning.*no final content/);
});

test('agent does not emit an empty-content error when tool calls are present', async () => {
  const mock = mockProvider();
  mock.enqueueResponse({
    content: '',
    tool_calls: [{ id: '1', name: 'repl_eval', args_json: '{"code":"42"}' }],
  });
  mock.enqueue('done');

  const agent = await createCodingReplAgent({
    provider: mock.handler,
    cwd: process.cwd(),
  });
  let errorEvents = 0;
  agent.subscribe((event) => {
    if (event.type === 'provider_event' && event.event.kind === 'error') errorEvents += 1;
  });

  await agent.prompt('do thing');
  assert.equal(errorEvents, 0);
});
