import type { StreamingChatHandler } from '../registry.js';
import { StreamAggregator } from '../stream/events.js';
import { sseLines } from '../stream/sse.js';
import type { LlmChatResponse, Message, ThinkingBlock, ToolCall } from '../types.js';

const PROVIDER = 'anthropic';

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  apiVersion?: string;
  defaultMaxTokens?: number;
}

export function anthropicProvider(options: AnthropicProviderOptions): StreamingChatHandler {
  return async (request, context) => {
    const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: request.max_tokens ?? options.defaultMaxTokens ?? 4096,
      stream: true,
      messages: request.messages
        .filter((message) => message.role !== 'system')
        .map(convertMessageToAnthropic),
    };
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    if (system.length > 0) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop !== undefined) body.stop_sequences = request.stop;
    if (request.reasoning?.enabled) {
      body.thinking = {
        type: 'enabled',
        budget_tokens: request.reasoning.budget_tokens ?? 8000,
      };
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
      body.tool_choice =
        request.tool_choice && typeof request.tool_choice === 'object'
          ? { type: 'tool', name: request.tool_choice.name }
          : {
              type:
                request.tool_choice === 'any'
                  ? 'any'
                  : request.tool_choice === 'none'
                    ? 'none'
                    : 'auto',
            };
    }

    context.emit({
      kind: 'started',
      run_id: context.runId,
      provider: PROVIDER,
      role: request.role,
      model: options.model,
    });

    const response = await fetch(`${options.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': options.apiVersion ?? '2023-06-01',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '<no body>');
      const message = `anthropic ${response.status}: ${text}`;
      context.emit({ kind: 'error', run_id: context.runId, provider: PROVIDER, message });
      throw new Error(message);
    }
    if (!response.body) {
      const message = 'anthropic: missing response body';
      context.emit({ kind: 'error', run_id: context.runId, provider: PROVIDER, message });
      throw new Error(message);
    }

    const aggregate = new StreamAggregator();
    const toolCalls: ToolCall[] = [];
    const thinking: ThinkingBlock[] = [];
    let active:
      | { kind: 'text' }
      | { kind: 'thinking'; text: string; signature?: string }
      | { kind: 'tool'; id: string; name: string; argsJson: string }
      | undefined;
    let finishReason: string | undefined;
    let tokensIn: number | undefined;
    let tokensOut: number | undefined;
    let cacheReadTokens: number | undefined;

    for await (const payload of sseLines(response.body)) {
      const event = safeJson<Record<string, unknown>>(payload);
      if (!event) continue;
      switch (event.type) {
        case 'message_start': {
          const message = event.message as AnthropicMessageStart | undefined;
          tokensIn = message?.usage?.input_tokens;
          tokensOut = message?.usage?.output_tokens;
          cacheReadTokens = message?.usage?.cache_read_input_tokens;
          break;
        }
        case 'content_block_start': {
          const block = event.content_block as AnthropicContentBlock | undefined;
          if (block?.type === 'tool_use' && block.id && block.name) {
            active = { kind: 'tool', id: block.id, name: block.name, argsJson: '' };
            context.emit({
              kind: 'tool_call_start',
              run_id: context.runId,
              provider: PROVIDER,
              id: block.id,
              name: block.name,
            });
          } else if (block?.type === 'thinking') {
            active = { kind: 'thinking', text: block.thinking ?? '', signature: block.signature };
          } else {
            active = { kind: 'text' };
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta as AnthropicDelta | undefined;
          if (!delta || !active) break;
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            const streamEvent = {
              kind: 'text' as const,
              run_id: context.runId,
              provider: PROVIDER,
              delta: delta.text,
            };
            aggregate.accept(streamEvent);
            context.emit(streamEvent);
          } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            if (active.kind === 'tool') active.argsJson += delta.partial_json;
            context.emit({
              kind: 'input_json_delta',
              run_id: context.runId,
              provider: PROVIDER,
              delta: delta.partial_json,
            });
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            if (active.kind === 'thinking') active.text += delta.thinking;
            context.emit({
              kind: 'thinking',
              run_id: context.runId,
              provider: PROVIDER,
              delta: delta.thinking,
            });
          } else if (delta.type === 'signature_delta' && typeof delta.signature === 'string') {
            if (active.kind === 'thinking') active.signature = delta.signature;
          }
          break;
        }
        case 'content_block_stop': {
          if (active?.kind === 'tool') {
            toolCalls.push({ id: active.id, name: active.name, args_json: active.argsJson });
          } else if (active?.kind === 'thinking') {
            thinking.push({ text: active.text, signature: active.signature });
          }
          context.emit({ kind: 'content_block_stop', run_id: context.runId, provider: PROVIDER });
          active = undefined;
          break;
        }
        case 'message_delta': {
          const delta = event.delta as { stop_reason?: string } | undefined;
          finishReason = delta?.stop_reason;
          const usage = event.usage as { output_tokens?: number } | undefined;
          if (usage?.output_tokens !== undefined) tokensOut = usage.output_tokens;
          break;
        }
      }
    }

    const finalResponse: LlmChatResponse = {
      content: aggregate.content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      thinking: thinking.length > 0 ? thinking : undefined,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cache_read_tokens: cacheReadTokens,
      finish_reason: finishReason,
    };
    context.emit({
      kind: 'done',
      run_id: context.runId,
      provider: PROVIDER,
      response: finalResponse,
    });
    return finalResponse;
  };
}

function convertMessageToAnthropic(message: Message): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: message.tool_call_id,
          content: message.content,
        },
      ],
    };
  }
  if (message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0) {
    const content: Array<Record<string, unknown>> = [];
    for (const block of message.thinking ?? []) {
      content.push({ type: 'thinking', thinking: block.text, signature: block.signature });
    }
    if (message.content.length > 0) content.push({ type: 'text', text: message.content });
    for (const call of message.tool_calls) {
      content.push({
        type: 'tool_use',
        id: call.id,
        name: call.name,
        input: safeJson<Record<string, unknown>>(call.args_json) ?? {},
      });
    }
    return { role: 'assistant', content };
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

interface AnthropicMessageStart {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface AnthropicContentBlock {
  type?: string;
  id?: string;
  name?: string;
  thinking?: string;
  signature?: string;
}

interface AnthropicDelta {
  type?: string;
  text?: string;
  partial_json?: string;
  thinking?: string;
  signature?: string;
}
