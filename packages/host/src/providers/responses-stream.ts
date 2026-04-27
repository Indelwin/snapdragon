import type { StreamingChatHandler } from '../registry.js';
import { StreamAggregator } from '../stream/events.js';
import { sseLines } from '../stream/sse.js';
import type { GeneratedImage, LlmChatResponse, ThinkingBlock, ToolCall } from '../types.js';

interface CallState {
  id: string;
  name: string;
  argsJson: string;
}

export async function readResponsesStream(
  body: ReadableStream<Uint8Array>,
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
): Promise<LlmChatResponse> {
  const aggregate = new StreamAggregator();
  const calls = new Map<string, CallState>();
  const generatedImages: GeneratedImage[] = [];
  const thinking: ThinkingBlock[] = [];
  let tokensIn: number | undefined;
  let tokensOut: number | undefined;
  let finishReason: string | undefined;
  let streamError: string | undefined;

  for await (const payload of sseLines(body)) {
    const event = safeJson<Record<string, unknown>>(payload);
    if (!event) continue;
    const type = event.type;
    if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
      acceptText(event.delta, provider, aggregate, context);
    } else if (type === 'response.reasoning_summary_text.delta') {
      acceptThinking(event.delta, provider, thinking, context);
    } else if (type === 'response.output_item.added' || type === 'response.output_item.done') {
      rememberCall(event.item, calls, provider, context);
      rememberImage(event.item, generatedImages, provider, context);
    } else if (type === 'response.image_generation_call.partial_image') {
      rememberPartialImage(event, generatedImages, provider, context);
    } else if (type === 'response.function_call_arguments.delta') {
      appendArgs(event, event.delta, calls, provider, context);
    } else if (type === 'response.completed') {
      const usage = usageFromResponse(event.response);
      tokensIn = usage.tokensIn;
      tokensOut = usage.tokensOut;
      finishReason = finishFromResponse(event.response);
    } else if (type === 'response.failed' || type === 'error') {
      streamError = errorMessage(event);
      context.emit({ kind: 'error', run_id: context.runId, provider, message: streamError });
    }
  }
  if (streamError) throw new Error(`${provider}: ${streamError}`);
  emitUsage(provider, context, tokensIn, tokensOut);
  return finish(
    provider,
    context,
    aggregate,
    calls,
    generatedImages,
    thinking,
    tokensIn,
    tokensOut,
    finishReason,
  );
}

function acceptText(
  delta: unknown,
  provider: string,
  aggregate: StreamAggregator,
  context: Parameters<StreamingChatHandler>[1],
): void {
  if (typeof delta !== 'string' || delta.length === 0) return;
  const event = { kind: 'text' as const, run_id: context.runId, provider, delta };
  aggregate.accept(event);
  context.emit(event);
}

function acceptThinking(
  delta: unknown,
  provider: string,
  thinking: ThinkingBlock[],
  context: Parameters<StreamingChatHandler>[1],
): void {
  if (typeof delta !== 'string' || delta.length === 0) return;
  thinking.push({ text: delta });
  context.emit({ kind: 'thinking', run_id: context.runId, provider, delta });
}

function rememberCall(
  raw: unknown,
  calls: Map<string, CallState>,
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
): void {
  const item = asRecord(raw);
  if (item.type !== 'function_call') return;
  const id = stringField(item, 'call_id') ?? stringField(item, 'id') ?? `call_${calls.size}`;
  const name = stringField(item, 'name') ?? calls.get(id)?.name ?? '';
  const argsJson = stringField(item, 'arguments') ?? calls.get(id)?.argsJson ?? '';
  const existed = calls.has(id);
  calls.set(id, { id, name, argsJson });
  if (!existed && name) {
    context.emit({ kind: 'tool_call_start', run_id: context.runId, provider, id, name });
  }
}

function rememberImage(
  raw: unknown,
  generatedImages: GeneratedImage[],
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
): void {
  const item = asRecord(raw);
  if (item.type !== 'image_generation_call') return;
  const image = generatedImageFromItem(item);
  if (!image.result && !image.id) return;
  upsertImage(generatedImages, image);
  context.emit({
    kind: 'image_generation',
    run_id: context.runId,
    provider,
    image,
  });
}

function rememberPartialImage(
  event: Record<string, unknown>,
  generatedImages: GeneratedImage[],
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
): void {
  const result = stringField(event, 'b64_json') ?? stringField(event, 'result');
  if (!result) return;
  const image: GeneratedImage = {
    id: stringField(event, 'item_id') ?? stringField(event, 'id'),
    result,
    partial: true,
    partial_index: numberField(event, 'partial_image_index'),
  };
  generatedImages.push(image);
  context.emit({
    kind: 'image_generation',
    run_id: context.runId,
    provider,
    image,
  });
}

function generatedImageFromItem(item: Record<string, unknown>): GeneratedImage {
  const result = stringField(item, 'result') ?? stringField(item, 'b64_json');
  const id = stringField(item, 'id');
  const revisedPrompt = stringField(item, 'revised_prompt');
  const metadata = providerMetadata(item, ['type', 'id', 'result', 'b64_json', 'revised_prompt']);
  return stripUndefined({
    id,
    result,
    revised_prompt: revisedPrompt,
    provider_metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
  }) as GeneratedImage;
}

function upsertImage(generatedImages: GeneratedImage[], image: GeneratedImage): void {
  if (!image.id) {
    generatedImages.push(image);
    return;
  }
  const index = generatedImages.findIndex(
    (existing) => existing.id === image.id && !existing.partial,
  );
  if (index === -1) generatedImages.push(image);
  else generatedImages[index] = { ...generatedImages[index], ...image };
}

function appendArgs(
  event: Record<string, unknown>,
  delta: unknown,
  calls: Map<string, CallState>,
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
): void {
  if (typeof delta !== 'string') return;
  const id = stringField(event, 'call_id') ?? stringField(event, 'item_id') ?? `call_${calls.size}`;
  const call = calls.get(id) ?? { id, name: '', argsJson: '' };
  call.argsJson += delta;
  calls.set(id, call);
  context.emit({ kind: 'input_json_delta', run_id: context.runId, provider, delta });
}

function usageFromResponse(raw: unknown): { tokensIn?: number; tokensOut?: number } {
  const usage = asRecord(asRecord(raw).usage);
  return {
    tokensIn: numberField(usage, 'input_tokens'),
    tokensOut: numberField(usage, 'output_tokens'),
  };
}

function finishFromResponse(raw: unknown): string | undefined {
  const response = asRecord(raw);
  if (response.status === 'incomplete') return 'length';
  if (response.status === 'failed') return 'error';
  return typeof response.status === 'string' ? response.status : undefined;
}

function emitUsage(
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
  input_tokens: number | undefined,
  output_tokens: number | undefined,
): void {
  if (input_tokens === undefined && output_tokens === undefined) return;
  context.emit({
    kind: 'usage',
    run_id: context.runId,
    provider,
    input_tokens: input_tokens ?? 0,
    output_tokens: output_tokens ?? 0,
  });
}

function finish(
  provider: string,
  context: Parameters<StreamingChatHandler>[1],
  aggregate: StreamAggregator,
  calls: Map<string, CallState>,
  generatedImages: GeneratedImage[],
  thinking: ThinkingBlock[],
  tokensIn: number | undefined,
  tokensOut: number | undefined,
  finishReason: string | undefined,
): LlmChatResponse {
  const tool_calls: ToolCall[] = [...calls.values()]
    .filter((call) => call.name.length > 0)
    .map((call) => ({ id: call.id, name: call.name, args_json: call.argsJson }));
  const response = {
    content: aggregate.content,
    tool_calls: tool_calls.length ? tool_calls : undefined,
    generated_images: generatedImages.length ? generatedImages : undefined,
    thinking: thinking.length ? thinking : undefined,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    finish_reason: finishReason,
  };
  context.emit({ kind: 'done', run_id: context.runId, provider, response });
  return response;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  return typeof record[key] === 'string' ? record[key] : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return typeof record[key] === 'number' ? record[key] : undefined;
}

function providerMetadata(
  record: Record<string, unknown>,
  exclude: string[],
): Record<string, unknown> {
  const excluded = new Set(exclude);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !excluded.has(key)));
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function errorMessage(event: Record<string, unknown>): string {
  return (
    stringField(asRecord(event.error), 'message') ??
    stringField(event, 'message') ??
    'stream failed'
  );
}

function safeJson<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}
