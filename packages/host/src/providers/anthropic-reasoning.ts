import type { ReasoningRequest } from '../types.js';

export function anthropicReasoning(
  model: string,
  reasoning: ReasoningRequest,
): Record<string, unknown> {
  if (!supportsAdaptiveThinking(model)) {
    return { thinking: { type: 'enabled', budget_tokens: reasoning.budget_tokens ?? 8000 } };
  }
  const body: Record<string, unknown> = {
    thinking: { type: 'adaptive', display: 'summarized' },
  };
  if (reasoning.effort) body.output_config = { effort: reasoning.effort };
  return body;
}

function supportsAdaptiveThinking(model: string): boolean {
  return ['claude-mythos-preview', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-sonnet-4-6'].some(
    (prefix) => model.startsWith(prefix),
  );
}
