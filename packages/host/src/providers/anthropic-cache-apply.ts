import {
  addAnthropicCacheControl,
  type NormalizedAnthropicPromptCachingOptions,
} from './anthropic-cache.js';

/**
 * Mark the last content block of the second-to-last message with a cache
 * breakpoint. The final message in a provider request is frequently a
 * volatile suffix — sd injects one-shot memory/skill context into the
 * current turn but only persists the visible user command — so caching
 * the message before that suffix keeps the durable transcript hot
 * without pinning request-only data into the cache key.
 */
export function applyStableMessageCacheBreakpoint(
  messages: Array<Record<string, unknown>>,
  cache: NormalizedAnthropicPromptCachingOptions | undefined,
): void {
  if (!cache?.enabled || !cache.cacheMessages) return;
  const targetIndex = messages.length - 2;
  if (targetIndex < 0) return;
  const target = messages[targetIndex];
  const content = target.content;
  if (!Array.isArray(content) || content.length === 0) return;
  const lastIndex = content.length - 1;
  content[lastIndex] = addAnthropicCacheControl(content[lastIndex], cache);
}

export function anthropicSystemContent(
  text: string | undefined,
  cache: NormalizedAnthropicPromptCachingOptions | undefined,
): string | Array<Record<string, unknown>> | undefined {
  if (!text) return undefined;
  if (!cache?.enabled || !cache.cacheSystem) return text;
  return [addAnthropicCacheControl({ type: 'text', text }, cache)];
}
