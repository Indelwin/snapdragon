import { createAgent } from '@snapdragon/agent';
import { mockProvider } from '@snapdragon/host';

const mock = mockProvider();
mock.enqueue('hello from snapdragon');

const agent = await createAgent({
  provider: mock.handler,
});

const response = await agent.prompt('Say hello');
console.log(response.content);
