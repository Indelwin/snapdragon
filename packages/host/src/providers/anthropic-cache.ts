import type {
  AnthropicPromptCachingInput,
  AnthropicPromptCachingOptions,
  NormalizedAnthropicPromptCachingOptions,
} from './anthropic-cache-types.js';

export type {
  AnthropicPromptCachingInput,
  AnthropicPromptCachingOptions,
  NormalizedAnthropicPromptCachingOptions,
} from './anthropic-cache-types.js';

const DISABLED: NormalizedAnthropicPromptCachingOptions = {
  enabled: false,
  automatic: false,
  cacheTools: false,
  cacheSystem: false,
  cacheMessages: false,
};

// Automatic cache writes are useful for raw chat clients, but agent
// runtimes often inject one-shot memory/skill context into the current
// request only. Cache stable prefixes explicitly by default so those
// volatile suffixes do not poison the next turn's cache key.
const ENABLED_DEFAULTS = {
  automatic: false,
  cacheTools: true,
  cacheSystem: true,
  cacheMessages: true,
} as const;

export function normalizeAnthropicPromptCaching(
  input: AnthropicPromptCachingInput,
): NormalizedAnthropicPromptCachingOptions {
  if (input === false) return DISABLED;
  const options = input === true || input === undefined ? {} : input;
  if (options.enabled === false) return DISABLED;
  return { enabled: true, ttl: options.ttl, ...ENABLED_DEFAULTS, ...explicitOverrides(options) };
}

function explicitOverrides(
  options: AnthropicPromptCachingOptions,
): Partial<NormalizedAnthropicPromptCachingOptions> {
  const out: Partial<NormalizedAnthropicPromptCachingOptions> = {};
  copyDefined(options, out, 'automatic');
  copyDefined(options, out, 'cacheTools');
  copyDefined(options, out, 'cacheSystem');
  copyDefined(options, out, 'cacheMessages');
  return out;
}

function copyDefined<K extends keyof AnthropicPromptCachingOptions>(
  src: AnthropicPromptCachingOptions,
  dest: Partial<NormalizedAnthropicPromptCachingOptions>,
  key: K,
): void {
  const value = src[key];
  if (value !== undefined) (dest as Record<string, unknown>)[key] = value;
}

export function cacheControlForAnthropic(
  options: NormalizedAnthropicPromptCachingOptions,
): Record<string, string> | undefined {
  if (!options.enabled) return undefined;
  const out: Record<string, string> = { type: 'ephemeral' };
  if (options.ttl) out.ttl = options.ttl;
  return out;
}

export function addAnthropicCacheControl<T extends Record<string, unknown>>(
  value: T,
  options: NormalizedAnthropicPromptCachingOptions,
): T {
  const cacheControl = cacheControlForAnthropic(options);
  if (!cacheControl) return value;
  return { ...value, cache_control: cacheControl };
}
