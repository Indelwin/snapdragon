import type { StreamingChatHandler } from '../registry.js';
import {
  addAnthropicCacheControl,
  type NormalizedAnthropicPromptCachingOptions,
} from './anthropic-cache.js';

export function anthropicTools(
  tools: NonNullable<Parameters<StreamingChatHandler>[0]['tools']>,
  cache: NormalizedAnthropicPromptCachingOptions,
): Array<Record<string, unknown>> {
  const mapped = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
  if (cache.enabled && cache.cacheTools && mapped.length > 0) {
    const lastIndex = mapped.length - 1;
    mapped[lastIndex] = addAnthropicCacheControl(mapped[lastIndex], cache);
  }
  return mapped;
}

export function anthropicToolChoice(
  choice: Parameters<StreamingChatHandler>[0]['tool_choice'],
): unknown {
  if (choice && typeof choice === 'object') return { type: 'tool', name: choice.name };
  if (choice === 'any') return { type: 'any' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'auto' };
}
