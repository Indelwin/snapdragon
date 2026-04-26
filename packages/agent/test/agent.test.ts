import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { mockProvider } from '@snapdragon-ai/host';
import { SessionStore } from '@snapdragon-ai/session';
import { createCodingReplAgent } from '../src/index.ts';
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

test('parseToolArgs accepts empty, valid JSON, and invalid JSON', () => {
  assert.deepEqual(parseToolArgs(''), {});
  assert.deepEqual(parseToolArgs('  \n '), {});
  assert.deepEqual(parseToolArgs('{"path":"README.md"}'), { path: 'README.md' });
  assert.deepEqual(parseToolArgs('[1,2]'), [1, 2]);
  assert.deepEqual(parseToolArgs('not json'), { raw: 'not json' });
});
