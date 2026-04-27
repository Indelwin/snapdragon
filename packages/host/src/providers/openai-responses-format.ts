import { contentText, dataUrl, normalizeContent } from '../content.js';
import type { ContentBlock, LlmChatRequest, Message, NativeToolDefinition } from '../types.js';
import { nonSystemMessages, systemInstructions, toolChoiceForResponses } from './shared.js';

export interface ResponsesPayload {
  body: Record<string, unknown>;
  instructions?: string;
}

export function openAIResponsesBody(model: string, request: LlmChatRequest): ResponsesPayload {
  const instructions = systemInstructions(request.messages);
  const body: Record<string, unknown> = {
    model,
    stream: true,
    store: false,
    input: nonSystemMessages(request).flatMap(messageToResponsesItems),
  };
  if (instructions) body.instructions = instructions;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.max_tokens !== undefined) body.max_output_tokens = request.max_tokens;
  if (request.stop !== undefined) body.stop = request.stop;
  const tools = [
    ...(request.tools ?? []).map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
    ...(request.native_tools ?? []).map(nativeToolForResponses),
  ];
  if (tools.length > 0) {
    body.tools = tools;
    if (request.tools && request.tools.length > 0) {
      body.tool_choice = toolChoiceForResponses(request.tool_choice);
    }
  }
  if (request.reasoning?.enabled || request.reasoning?.effort) {
    body.reasoning = {
      effort: request.reasoning.effort ?? 'medium',
      summary: request.reasoning.summary ?? 'auto',
    };
  }
  return { body, instructions };
}

function nativeToolForResponses(tool: NativeToolDefinition): Record<string, unknown> {
  if (tool.type === 'image_generation') {
    return stripUndefined({
      type: 'image_generation',
      model: tool.model,
      size: tool.size,
      quality: tool.quality,
      background: tool.background,
      output_format: tool.output_format,
      output_compression: tool.output_compression,
      partial_images: tool.partial_images,
      action: tool.action,
    });
  }
  return stripUndefined({ ...tool });
}

function stripUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

export function messageToResponsesItems(message: Message): Array<Record<string, unknown>> {
  if (message.role === 'tool') {
    return [
      {
        type: 'function_call_output',
        call_id: message.tool_call_id,
        output: contentText(message.content),
      },
    ];
  }
  const items: Array<Record<string, unknown>> = [];
  const content = normalizeContent(message.content).map(responsesContentBlock);
  if (content.length > 0) items.push({ type: 'message', role: message.role, content });
  for (const call of message.tool_calls ?? []) {
    items.push({
      type: 'function_call',
      call_id: call.id,
      name: call.name,
      arguments: call.args_json,
    });
  }
  return items;
}

function responsesContentBlock(block: ContentBlock): Record<string, unknown> {
  if (block.type === 'text') return { type: 'input_text', text: block.text };
  if (block.type === 'image') return responsesImageBlock(block);
  if (block.type === 'file') return responsesFileBlock(block);
  return { type: 'input_text', text: contentText(block.content) };
}

function responsesImageBlock(
  block: Extract<ContentBlock, { type: 'image' }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'input_image', detail: block.detail ?? 'auto' };
  if (block.source.type === 'url') out.image_url = block.source.url;
  if (block.source.type === 'base64')
    out.image_url = dataUrl(block.source.media_type, block.source.data);
  if (block.source.type === 'file') out.file_id = block.source.file_id;
  return out;
}

function responsesFileBlock(
  block: Extract<ContentBlock, { type: 'file' }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'input_file' };
  if (block.filename) out.filename = block.filename;
  if (block.source.type === 'url') out.file_url = block.source.url;
  if (block.source.type === 'base64') out.file_data = block.source.data;
  if (block.source.type === 'file') out.file_id = block.source.file_id;
  return out;
}
