import { createAgent } from '@snapdragon-ai/agent';
import { mockProvider } from '@snapdragon-ai/host';

const mock = mockProvider();
mock.enqueue('hello from snapdragon');

const agent = await createAgent({
  provider: mock.handler,
});

const response = await agent.prompt('Say hello');
console.log(response.content);
