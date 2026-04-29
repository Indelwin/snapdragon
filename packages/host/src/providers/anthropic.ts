import type { StreamingChatHandler } from '../registry.js';
import type { ProviderDescriptor } from '../types.js';
import { anthropicSystem, convertMessageToAnthropic } from './anthropic-format.js';
import { anthropicReasoning } from './anthropic-reasoning.js';
import { readAnthropicStream } from './anthropic-stream.js';
import { type FetchLike, fetchImpl } from './shared.js';

export { listAnthropicModels } from '../model-discovery.js';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultMaxTokens?: number;
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

export function anthropicBody(
  options: Pick<AnthropicProviderOptions, 'model' | 'defaultMaxTokens'>,
  request: Parameters<StreamingChatHandler>[0],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: request.max_tokens ?? options.defaultMaxTokens ?? 4096,
    stream: true,
    messages: request.messages.map(convertMessageToAnthropic).filter(Boolean),
  };
  const system = anthropicSystem(request.messages);
  if (system) body.system = system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.stop !== undefined) body.stop_sequences = request.stop;
  if (request.reasoning?.enabled) {
    Object.assign(body, anthropicReasoning(options.model, request.reasoning));
  }
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
    body.tool_choice = anthropicToolChoice(request.tool_choice);
  }
  return body;
}

function anthropicToolChoice(choice: Parameters<StreamingChatHandler>[0]['tool_choice']): unknown {
  if (choice && typeof choice === 'object') return { type: 'tool', name: choice.name };
  if (choice === 'any') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'auto' };
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
