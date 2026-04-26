import { createCodingReplAgent } from '@snapdragon/agent';
import { mockProvider } from '@snapdragon/host';

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
});

const response = await agent.prompt('List your tools with the REPL');
console.log(response.content);
