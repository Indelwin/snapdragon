import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mockProvider } from '@snapdragon-ai/host';
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

test('parseToolArgs accepts empty, valid JSON, and invalid JSON', () => {
  assert.deepEqual(parseToolArgs(''), {});
  assert.deepEqual(parseToolArgs('  \n '), {});
  assert.deepEqual(parseToolArgs('{"path":"README.md"}'), { path: 'README.md' });
  assert.deepEqual(parseToolArgs('[1,2]'), [1, 2]);
  assert.deepEqual(parseToolArgs('not json'), { raw: 'not json' });
});
