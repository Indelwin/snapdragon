import type { StreamingChatHandler } from '../registry.js';
import { cacheControlForAnthropic, normalizeAnthropicPromptCaching } from './anthropic-cache.js';
import type { AnthropicBodyOptions } from './anthropic-cache-types.js';
import { anthropicSystemContent, convertMessagesToAnthropic } from './anthropic-format.js';
import { anthropicReasoning } from './anthropic-reasoning.js';
import { anthropicToolChoice, anthropicTools } from './anthropic-tools.js';

export type { AnthropicBodyOptions } from './anthropic-cache-types.js';

export function anthropicBody(
  options: AnthropicBodyOptions,
  request: Parameters<StreamingChatHandler>[0],
): Record<string, unknown> {
  const cache = normalizeAnthropicPromptCaching(options.promptCaching);
  const body: Record<string, unknown> = {
    model: options.model,
    max_tokens: request.max_tokens ?? options.defaultMaxTokens ?? 4096,
    stream: true,
    messages: convertMessagesToAnthropic(request.messages, cache),
  };
  const system = anthropicSystemContent(request.messages, cache);
  if (system) body.system = system;
  if (cache.automatic) body.cache_control = cacheControlForAnthropic(cache);
  applyOptionalRequestFields(body, request, options.model);
  applyToolFields(body, request, cache);
  return body;
}

function applyOptionalRequestFields(
  body: Record<string, unknown>,
  request: Parameters<StreamingChatHandler>[0],
  model: string,
): void {
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.stop !== undefined) body.stop_sequences = request.stop;
  if (request.reasoning?.enabled) {
    Object.assign(body, anthropicReasoning(model, request.reasoning));
  }
}

function applyToolFields(
  body: Record<string, unknown>,
  request: Parameters<StreamingChatHandler>[0],
  cache: ReturnType<typeof normalizeAnthropicPromptCaching>,
): void {
  if (!request.tools || request.tools.length === 0) return;
  body.tools = anthropicTools(request.tools, cache);
  body.tool_choice = anthropicToolChoice(request.tool_choice);
}
