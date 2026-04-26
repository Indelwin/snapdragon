import type { StreamingChatHandler } from '../registry.js';
import { StreamAggregator } from '../stream/events.js';
import { sseLines } from '../stream/sse.js';
import type { LlmChatResponse, ThinkingBlock, ToolCall } from '../types.js';

const PROVIDER = 'anthropic';

type StreamContext = Parameters<StreamingChatHandler>[1];

export async function readAnthropicStream(
  body: ReadableStream<Uint8Array>,
  context: StreamContext,
): Promise<LlmChatResponse> {
  const aggregate = new StreamAggregator();
  const toolCalls: ToolCall[] = [];
  const thinking: ThinkingBlock[] = [];
  const usage = {};
  let active: ActiveBlock | undefined;
  let finishReason: string | undefined;

  for await (const payload of sseLines(body)) {
    const event = safeJson<Record<string, unknown>>(payload);
    if (!event) continue;
    if (event.type === 'message_start') readStartUsage(event, usage);
    if (event.type === 'content_block_start') active = startBlock(event, context);
    if (event.type === 'content_block_delta' && active)
      updateBlock(event, active, aggregate, context);
    if (event.type === 'content_block_stop' && active) {
      active = stopBlock(active, toolCalls, thinking, context);
    }
    if (event.type === 'message_delta') finishReason = readMessageDelta(event, usage);
  }
  return finishAnthropic(aggregate, toolCalls, thinking, usage, finishReason, context);
}

type ActiveBlock =
  | { kind: 'text' }
  | { kind: 'thinking'; text: string; signature?: string }
  | { kind: 'tool'; id: string; name: string; argsJson: string };

interface UsageState {
  input?: number;
  output?: number;
  cache?: number;
}

function startBlock(event: Record<string, unknown>, context: StreamContext): ActiveBlock {
  const block = asRecord(event.content_block);
  if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
    context.emit({
      kind: 'tool_call_start',
      run_id: context.runId,
      provider: PROVIDER,
      id: block.id,
      name: block.name,
    });
    return { kind: 'tool', id: block.id, name: block.name, argsJson: '' };
  }
  if (block.type === 'thinking') return startThinking(block);
  return { kind: 'text' };
}

function startThinking(block: Record<string, unknown>): ActiveBlock {
  return {
    kind: 'thinking',
    text: typeof block.thinking === 'string' ? block.thinking : '',
    signature: typeof block.signature === 'string' ? block.signature : undefined,
  };
}

function updateBlock(
  event: Record<string, unknown>,
  active: ActiveBlock,
  aggregate: StreamAggregator,
  context: StreamContext,
): void {
  const delta = asRecord(event.delta);
  if (delta.type === 'text_delta' && typeof delta.text === 'string') {
    acceptText(delta.text, aggregate, context);
  }
  if (
    delta.type === 'input_json_delta' &&
    active.kind === 'tool' &&
    typeof delta.partial_json === 'string'
  ) {
    active.argsJson += delta.partial_json;
    context.emit({
      kind: 'input_json_delta',
      run_id: context.runId,
      provider: PROVIDER,
      delta: delta.partial_json,
    });
  }
  if (
    delta.type === 'thinking_delta' &&
    active.kind === 'thinking' &&
    typeof delta.thinking === 'string'
  ) {
    active.text += delta.thinking;
    context.emit({
      kind: 'thinking',
      run_id: context.runId,
      provider: PROVIDER,
      delta: delta.thinking,
    });
  }
  if (
    delta.type === 'signature_delta' &&
    active.kind === 'thinking' &&
    typeof delta.signature === 'string'
  ) {
    active.signature = delta.signature;
  }
}

function acceptText(delta: string, aggregate: StreamAggregator, context: StreamContext): void {
  const event = { kind: 'text' as const, run_id: context.runId, provider: PROVIDER, delta };
  aggregate.accept(event);
  context.emit(event);
}

function stopBlock(
  active: ActiveBlock,
  toolCalls: ToolCall[],
  thinking: ThinkingBlock[],
  context: StreamContext,
): undefined {
  if (active.kind === 'tool')
    toolCalls.push({ id: active.id, name: active.name, args_json: active.argsJson });
  if (active.kind === 'thinking') thinking.push({ text: active.text, signature: active.signature });
  context.emit({ kind: 'content_block_stop', run_id: context.runId, provider: PROVIDER });
  return undefined;
}

function readStartUsage(event: Record<string, unknown>, usage: UsageState): void {
  const raw = asRecord(asRecord(event.message).usage);
  usage.input = numberField(raw, 'input_tokens');
  usage.output = numberField(raw, 'output_tokens');
  usage.cache = numberField(raw, 'cache_read_input_tokens');
}

function readMessageDelta(event: Record<string, unknown>, usage: UsageState): string | undefined {
  const delta = asRecord(event.delta);
  const rawUsage = asRecord(event.usage);
  usage.output = numberField(rawUsage, 'output_tokens') ?? usage.output;
  return typeof delta.stop_reason === 'string' ? delta.stop_reason : undefined;
}

function finishAnthropic(
  aggregate: StreamAggregator,
  toolCalls: ToolCall[],
  thinking: ThinkingBlock[],
  usage: UsageState,
  finishReason: string | undefined,
  context: StreamContext,
): LlmChatResponse {
  const response = {
    content: aggregate.content,
    tool_calls: toolCalls.length ? toolCalls : undefined,
    thinking: thinking.length ? thinking : undefined,
    tokens_in: usage.input,
    tokens_out: usage.output,
    cache_read_tokens: usage.cache,
    finish_reason: finishReason,
  };
  context.emit({ kind: 'done', run_id: context.runId, provider: PROVIDER, response });
  return response;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' ? record[key] : undefined;
}

function safeJson<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}
