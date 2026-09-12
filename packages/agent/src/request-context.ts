import type { Message, ToolDefinition } from '@snapdragon-ai/host';
import {
  contextOptions,
  estimateRequestTokens,
  requestBudget,
  requestHistoryBudget,
  tailCandidates,
} from './request-context-budget.js';
import { ContextBudgetExceededError } from './request-context-error.js';
import { decorateMessages, type RequestReplacement } from './request-context-messages.js';
import { contextCanCompact } from './request-context-session.js';
import { uncompactedRequestMessages } from './request-context-uncompacted.js';
import type { AgentContextOptions, AgentSession } from './types.js';

export { estimateRequestTokens } from './request-context-budget.js';
export {
  ContextBudgetExceededError,
  isContextBudgetExceededError,
  isContextWindowError,
  shouldRetryContextWindow,
} from './request-context-error.js';
export type { RequestReplacement } from './request-context-messages.js';

export interface RequestContextInput {
  context: AgentContextOptions | undefined;
  fallbackMessages: Message[];
  replacement?: RequestReplacement;
  session: AgentSession | undefined;
  systemMessages: Message[];
  tools: ToolDefinition[];
  pressure?: number;
}

export async function assembleProviderRequestMessages(
  input: RequestContextInput,
): Promise<Message[]> {
  if (!contextCanCompact(input)) return uncompactedRequestMessages(input);

  const context = input.context as AgentContextOptions;
  const budget = requestBudget(context, input.pressure);
  const historyBudget = requestHistoryBudget(
    budget,
    input.systemMessages,
    input.tools,
    input.replacement,
  );
  const tails = tailCandidates(context.freshTailCount, input.pressure);
  let best: Message[] | undefined;
  let bestTokens = Number.POSITIVE_INFINITY;

  for (const freshTailCount of tails) {
    const options = contextOptions(context, freshTailCount, historyBudget);
    await input.session.compactContext?.(options);
    const assembled = await input.session.assembleContext?.(options);
    const messages = decorateMessages(input.systemMessages, assembled ?? [], input.replacement);
    const tokens = estimateRequestTokens(messages, input.tools);
    if (tokens < bestTokens) {
      best = messages;
      bestTokens = tokens;
    }
    if (budget === undefined || tokens <= budget) return messages;
  }

  if (best && budget !== undefined && bestTokens > budget) {
    throw new ContextBudgetExceededError(bestTokens, budget);
  }
  return best ?? decorateMessages(input.systemMessages, input.fallbackMessages, input.replacement);
}
