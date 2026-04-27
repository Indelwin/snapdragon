import type { StreamingChatHandler } from '../registry.js';
import { StreamAggregator } from '../stream/events.js';
import { sseLines } from '../stream/sse.js';
import type { LlmChatResponse, Message, ProviderDescriptor, ToolCall } from '../types.js';
import {
  type FetchLike,
  fetchImpl,
  openAIChatContent,
  textFromMessage,
  toolChoiceForOpenAI,
} from './shared.js';

const PROVIDER = 'openai-compatible';

export { listOpenAICompatibleModels } from '../model-discovery.js';

export interface OpenAICompatibleProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  organization?: string;
  fetch?: FetchLike;
}

export const openaiCompatibleProviderDescriptor: ProviderDescriptor = {
  id: PROVIDER,
  name: 'OpenAI-compatible Chat Completions',
  protocol: 'openai.chat-completions',
  capabilities: {
    streaming: true,
    tools: true,
    imageInput: true,
    fileInput: true,
    reasoning: false,
    modelDiscovery: true,
    imageGeneration: false,
  },
};

export function openaiCompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): StreamingChatHandler {
  return async (request, context) => {
    const body = openAIChatBody(options.model, request);
    const response = await fetchImpl(options.fetch)(
      `${options.baseUrl ?? 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        headers: requestHeaders(options),
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) await throwProviderError(response, context.runId);
    if (!response.body) throw new Error('openai-compatible: missing response body');
    return readChatStream(response.body, context);
  };
}

export const openaiProvider = openaiCompatibleProvider;
export type OpenAIProviderOptions = OpenAICompatibleProviderOptions;

export function openAIChatBody(
  model: string,
  request: Parameters<StreamingChatHandler>[0],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: request.messages.map(convertMessageToOpenAI),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.max_tokens !== undefined) body.max_tokens = request.max_tokens;
  if (request.stop !== undefined) body.stop = request.stop;
  if (request.reasoning?.effort) body.reasoning_effort = request.reasoning.effort;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = toolChoiceForOpenAI(request.tool_choice);
  }
  return body;
}

export function convertMessageToOpenAI(message: Message): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: textFromMessage(message),
      tool_call_id: message.tool_call_id,
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return {
      role: 'assistant',
      content: textFromMessage(message) || null,
      tool_calls: message.tool_calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.args_json },
      })),
    };
  }
  return { role: message.role, content: openAIChatContent(message.content) };
}

function requestHeaders(options: OpenAICompatibleProviderOptions): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${options.apiKey}`,
    accept: 'text/event-stream',
    ...(options.extraHeaders ?? {}),
  };
  if (options.organization) headers['OpenAI-Organization'] = options.organization;
  return headers;
}

async function throwProviderError(response: Response, runId: string): Promise<never> {
  const text = await response.text().catch(() => '<no body>');
  const message = `openai-compatible ${response.status}: ${text}`;
  throw Object.assign(new Error(message), { runId });
}

async function readChatStream(
  body: ReadableStream<Uint8Array>,
  context: Parameters<StreamingChatHandler>[1],
): Promise<LlmChatResponse> {
  context.emit({ kind: 'started', run_id: context.runId, provider: PROVIDER, role: 'assistant' });
  const aggregate = new StreamAggregator();
  const calls = new Map<number, { id: string; name: string; argsJson: string; started: boolean }>();
  let finishReason: string | undefined;
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;

  for await (const payload of sseLines(body)) {
    if (payload === '[DONE]') break;
    const event = safeJson<OpenAIStreamEvent>(payload);
    if (!event) continue;
    const choice = event.choices?.[0];
    acceptText(choice?.delta?.content, aggregate, context);
    acceptToolCalls(choice?.delta?.tool_calls ?? [], calls, context);
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    if (event.usage) {
      tokensIn = event.usage.prompt_tokens;
      tokensOut = event.usage.completion_tokens;
    }
  }
  emitUsage(tokensIn, tokensOut, context);
  return finishChat(aggregate, calls, finishReason, tokensIn, tokensOut, context);
}

function acceptText(
  delta: string | undefined,
  aggregate: StreamAggregator,
  context: Parameters<StreamingChatHandler>[1],
): void {
  if (!delta) return;
  const event = { kind: 'text' as const, run_id: context.runId, provider: PROVIDER, delta };
  aggregate.accept(event);
  context.emit(event);
}

function acceptToolCalls(
  deltas: OpenAIToolCallDelta[] | undefined,
  calls: Map<number, { id: string; name: string; argsJson: string; started: boolean }>,
  context: Parameters<StreamingChatHandler>[1],
): void {
  for (const delta of deltas ?? []) {
    const index = delta.index ?? 0;
    const call = calls.get(index) ?? {
      id: delta.id ?? `call_${index}`,
      name: '',
      argsJson: '',
      started: false,
    };
    calls.set(index, call);
    if (delta.id) call.id = delta.id;
    if (delta.function?.name) call.name = delta.function.name;
    if (!call.started && call.name) {
      context.emit({
        kind: 'tool_call_start',
        run_id: context.runId,
        provider: PROVIDER,
        id: call.id,
        name: call.name,
      });
      call.started = true;
    }
    if (typeof delta.function?.arguments === 'string') {
      call.argsJson += delta.function.arguments;
      context.emit({
        kind: 'input_json_delta',
        run_id: context.runId,
        provider: PROVIDER,
        delta: delta.function.arguments,
      });
    }
  }
}

function emitUsage(
  tokensIn: number | undefined,
  tokensOut: number | undefined,
  context: Parameters<StreamingChatHandler>[1],
): void {
  if (tokensIn === undefined && tokensOut === undefined) return;
  context.emit({
    kind: 'usage',
    run_id: context.runId,
    provider: PROVIDER,
    input_tokens: tokensIn ?? 0,
    output_tokens: tokensOut ?? 0,
  });
}

function finishChat(
  aggregate: StreamAggregator,
  calls: Map<number, { id: string; name: string; argsJson: string }>,
  finishReason: string | undefined,
  tokensIn: number | undefined,
  tokensOut: number | undefined,
  context: Parameters<StreamingChatHandler>[1],
): LlmChatResponse {
  const tool_calls: ToolCall[] = [...calls.values()]
    .filter((call) => call.name.length > 0)
    .map((call) => ({ id: call.id, name: call.name, args_json: call.argsJson }));
  const response = {
    content: aggregate.content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    finish_reason: finishReason,
  };
  context.emit({ kind: 'done', run_id: context.runId, provider: PROVIDER, response });
  return response;
}

function safeJson<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}

interface OpenAIStreamEvent {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: OpenAIToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}
