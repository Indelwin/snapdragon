import type { Message, ToolDefinition } from '@snapdragon-ai/host';
import { estimateRequestTokens, requestBudget } from './request-context-budget.js';
import { ContextBudgetExceededError } from './request-context-error.js';
import { decorateMessages, type RequestReplacement } from './request-context-messages.js';
import type { AgentContextOptions } from './types.js';

export function uncompactedRequestMessages(input: {
  context: AgentContextOptions | undefined;
  fallbackMessages: Message[];
  replacement?: RequestReplacement;
  systemMessages: Message[];
  tools: ToolDefinition[];
  pressure?: number;
}): Message[] {
  const messages = decorateMessages(
    input.systemMessages,
    input.fallbackMessages,
    input.replacement,
  );
  const budget = input.context ? requestBudget(input.context, input.pressure) : undefined;
  const tokens = estimateRequestTokens(messages, input.tools);
  if (budget !== undefined && tokens > budget) throw new ContextBudgetExceededError(tokens, budget);
  return messages;
}
