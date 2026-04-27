import type { StreamingChatHandler } from '../registry.js';
import type { ProviderDescriptor } from '../types.js';
import { openAIResponsesBody } from './openai-responses-format.js';
import { readResponsesStream } from './responses-stream.js';
import { type FetchLike, fetchImpl } from './shared.js';

const PROVIDER = 'openai';

export { listOpenAIResponsesModels } from '../model-discovery.js';

export interface OpenAIResponsesProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  organization?: string;
  fetch?: FetchLike;
}

export const openaiResponsesProviderDescriptor: ProviderDescriptor = {
  id: PROVIDER,
  name: 'OpenAI Responses',
  protocol: 'openai.responses',
  capabilities: {
    streaming: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    reasoning: true,
    modelDiscovery: true,
    imageGeneration: 'responses-tool',
  },
};

export function openaiResponsesProvider(
  options: OpenAIResponsesProviderOptions,
): StreamingChatHandler {
  return async (request, context) => {
    const { body } = openAIResponsesBody(options.model, request);
    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: PROVIDER,
      role: request.role,
      model: options.model,
    });
    const response = await fetchImpl(options.fetch)(`${baseUrl(options)}/responses`, {
      method: 'POST',
      headers: requestHeaders(options),
      body: JSON.stringify(body),
    });
    if (!response.ok) await throwProviderError(response);
    if (!response.body) throw new Error('openai responses: missing response body');
    return readResponsesStream(response.body, PROVIDER, context);
  };
}

function baseUrl(options: OpenAIResponsesProviderOptions): string {
  return (options.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
}

function requestHeaders(options: OpenAIResponsesProviderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    accept: 'text/event-stream',
    ...(options.extraHeaders ?? {}),
  };
  if (options.organization) headers['OpenAI-Organization'] = options.organization;
  return headers;
}

async function throwProviderError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  throw new Error(`openai responses ${response.status}: ${text}`);
}
