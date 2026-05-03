import {
  codexModelLimits,
  type ProviderModelLimits,
  type ReasoningRequest,
  type StreamingChatHandler,
} from '@snapdragon-ai/host';
import type { SdProviderKind } from './config.js';

export type { ProviderModelLimits } from '@snapdragon-ai/host';

export interface SdProviderRuntime {
  id: string;
  kind: SdProviderKind;
  model: string;
  handler: StreamingChatHandler;
  reasoning?: ReasoningRequest;
  /**
   * Per-model context-window / output limits when the host knows them
   * (currently: Codex models from `codexModelLimits()`). Other providers
   * leave this `undefined`; downstream callers fall back to the user's
   * `agent.context.max_request_tokens` config.
   */
  limits?: ProviderModelLimits;
}

/**
 * Look up per-model context-window / output limits for built-in providers.
 * Returns `undefined` for providers without per-model limit data.
 */
export function providerModelLimits(
  kind: SdProviderKind,
  model: string,
): ProviderModelLimits | undefined {
  if (kind === 'openai-codex') return codexModelLimits(model);
  return undefined;
}
