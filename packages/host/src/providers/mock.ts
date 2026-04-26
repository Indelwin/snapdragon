import type { LlmChatRequest, LlmChatResponse } from '../types.js';
import type { StreamingChatHandler } from '../registry.js';

const PROVIDER = 'mock';

export interface MockProviderHandle {
  handler: StreamingChatHandler;
  enqueue(content: string): void;
  enqueueResponse(response: LlmChatResponse): void;
  history(): LlmChatRequest[];
}

export interface MockProviderOptions {
  chunkSize?: number;
  chunkDelayMs?: number;
}

export function mockProvider(options: MockProviderOptions = {}): MockProviderHandle {
  const queue: LlmChatResponse[] = [];
  const history: LlmChatRequest[] = [];

  const handler: StreamingChatHandler = async (request, context) => {
    history.push(request);
    const next = queue.shift() ?? { content: 'mock response' };

    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: PROVIDER,
      role: request.role,
    });

    const content = next.content ?? '';
    if (options.chunkSize && options.chunkSize > 0) {
      for (let i = 0; i < content.length; i += options.chunkSize) {
        const delta = content.slice(i, i + options.chunkSize);
        context.emit({ kind: 'text', run_id: context.runId, provider: PROVIDER, delta });
        if (options.chunkDelayMs && options.chunkDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, options.chunkDelayMs));
        }
      }
    } else if (content.length > 0) {
      context.emit({ kind: 'text', run_id: context.runId, provider: PROVIDER, delta: content });
    }

    context.emit({ kind: 'done', run_id: context.runId, provider: PROVIDER, response: next });
    return next;
  };

  return {
    handler,
    enqueue(content: string) {
      queue.push({ content });
    },
    enqueueResponse(response: LlmChatResponse) {
      queue.push(response);
    },
    history() {
      return [...history];
    },
  };
}
