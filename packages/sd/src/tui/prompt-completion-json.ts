import type { JsonValue } from '@snapdragon-ai/ui';
import type { PromptCompletionState } from './input-completion.js';

export function promptCompletionJson(completion: PromptCompletionState | undefined): JsonValue {
  if (completion === undefined) return null;
  return {
    mode: completion.mode,
    query: completion.query,
    selectedIndex: completion.selectedIndex,
    suggestions: completion.suggestions.map((suggestion) => ({ ...suggestion })),
  };
}
