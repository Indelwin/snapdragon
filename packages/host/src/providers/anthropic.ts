import type { StreamingChatHandler } from '../registry.js';
import type { ProviderDescriptor } from '../types.js';
import { anthropicBody } from './anthropic-body.js';
import type { AnthropicPromptCachingInput } from './anthropic-cache.js';
import { readAnthropicStream } from './anthropic-stream.js';
import { type FetchLike, fetchImpl } from './shared.js';

export { listAnthropicModels } from '../model-discovery.js';
export { anthropicBody } from './anthropic-body.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultMaxTokens?: number;
  promptCaching?: AnthropicPromptCachingInput;
  fetch?: FetchLike;
}

export const anthropicProviderDescriptor: ProviderDescriptor = {
  id: 'anthropic',
  name: 'Anthropic Messages',
  protocol: 'anthropic.messages',
  capabilities: {
    streaming: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    reasoning: true,
    modelDiscovery: true,
    imageGeneration: false,
  },
};

export function anthropicProvider(options: AnthropicProviderOptions): StreamingChatHandler {
  return async (request, context) => {
    const response = await fetchImpl(options.fetch)(
      `${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`,
      {
        method: 'POST',
        headers: requestHeaders(options),
        body: JSON.stringify(anthropicBody(options, request)),
      },
    );
    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: 'anthropic',
      role: request.role,
      model: options.model,
    });
    if (!response.ok) await throwProviderError(response);
    if (!response.body) throw new Error('anthropic: missing response body');
    return readAnthropicStream(response.body, context);
  };
}

function requestHeaders(options: AnthropicProviderOptions): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-api-key': options.apiKey,
    'anthropic-version': options.apiVersion ?? '2023-06-01',
    accept: 'text/event-stream',
  };
}

async function throwProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`anthropic ${response.status}: ${text}`);
}
