import type { LlmChatResponse, Message, ToolCall } from '../types.js';
import type { StreamingChatHandler } from '../registry.js';
import { StreamAggregator } from '../stream/events.js';
import { sseLines } from '../stream/sse.js';

const PROVIDER = 'openai';

export interface OpenAIProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  organization?: string;
}

export function openaiProvider(options: OpenAIProviderOptions): StreamingChatHandler {
  return async (request, context) => {
    const baseUrl = options.baseUrl ?? 'https://api.openai.com/v1';
    const body: Record<string, unknown> = {
      model: options.model,
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
      body.tool_choice =
        request.tool_choice === undefined || request.tool_choice === 'any'
          ? 'auto'
          : request.tool_choice === 'none'
            ? 'none'
            : typeof request.tool_choice === 'string'
              ? request.tool_choice
              : { type: 'function', function: { name: request.tool_choice.name } };
    }

    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: PROVIDER,
      role: request.role,
      model: options.model,
    });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${options.apiKey}`,
      accept: 'text/event-stream',
      ...(options.extraHeaders ?? {}),
    };
    if (options.organization) headers['OpenAI-Organization'] = options.organization;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<no body>');
      const message = `openai-compatible ${response.status}: ${text}`;
      context.emit({ kind: 'error', run_id: context.runId, provider: PROVIDER, message });
      throw new Error(message);
    }
    if (!response.body) {
      const message = 'openai-compatible: missing response body';
      context.emit({ kind: 'error', run_id: context.runId, provider: PROVIDER, message });
      throw new Error(message);
    }

    const aggregate = new StreamAggregator();
    let finishReason: string | undefined;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    const calls = new Map<number, { id: string; name: string; argsJson: string; started: boolean }>();

    for await (const payload of sseLines(response.body)) {
      if (payload === '[DONE]') break;
      const event = safeJson<OpenAIStreamEvent>(payload);
      if (!event) continue;

      const choice = event.choices?.[0];
      const delta = choice?.delta;
      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        const streamEvent = {
          kind: 'text' as const,
          run_id: context.runId,
          provider: PROVIDER,
          delta: delta.content,
        };
        aggregate.accept(streamEvent);
        context.emit(streamEvent);
      }

      for (const toolCall of delta?.tool_calls ?? []) {
        const index = toolCall.index ?? 0;
        let item = calls.get(index);
        if (!item) {
          item = { id: toolCall.id ?? `call_${index}`, name: '', argsJson: '', started: false };
          calls.set(index, item);
        }
        if (toolCall.id) item.id = toolCall.id;
        if (toolCall.function?.name) item.name = toolCall.function.name;
        if (!item.started && item.name) {
          context.emit({
            kind: 'tool_call_start',
            run_id: context.runId,
            provider: PROVIDER,
            id: item.id,
            name: item.name,
          });
          item.started = true;
        }
        if (typeof toolCall.function?.arguments === 'string') {
          item.argsJson += toolCall.function.arguments;
          context.emit({
            kind: 'input_json_delta',
            run_id: context.runId,
            provider: PROVIDER,
            delta: toolCall.function.arguments,
          });
        }
      }

      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      if (event.usage) {
        tokensIn = event.usage.prompt_tokens;
        tokensOut = event.usage.completion_tokens;
      }
    }

    if (tokensIn !== undefined || tokensOut !== undefined) {
      context.emit({
        kind: 'usage',
        run_id: context.runId,
        provider: PROVIDER,
        input_tokens: tokensIn ?? 0,
        output_tokens: tokensOut ?? 0,
      });
    }

    const tool_calls: ToolCall[] = [...calls.values()]
      .filter((call) => call.name.length > 0)
      .map((call) => ({ id: call.id, name: call.name, args_json: call.argsJson }));

    const finalResponse: LlmChatResponse = {
      content: aggregate.content,
      tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      finish_reason: finishReason,
    };
    context.emit({ kind: 'done', run_id: context.runId, provider: PROVIDER, response: finalResponse });
    return finalResponse;
  };
}

function convertMessageToOpenAI(message: Message): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.tool_call_id,
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.tool_calls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.args_json },
      })),
    };
  }
  return { role: message.role, content: message.content };
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
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}
