import type { Message } from '@snapdragon-ai/host';
import { ContextReadBudgetExceededError } from '@snapdragon-ai/session';
import type { AgentContextOptions, AgentSession } from './types.js';

export interface RequestContextSessionInput {
  context: AgentContextOptions | undefined;
  session: AgentSession | undefined;
}

export function contextCanCompact<T extends RequestContextSessionInput>(
  input: T,
): input is T & { context: AgentContextOptions; session: AgentSession } {
  if (!input.context?.enabled) return false;
  if (!input.session) return false;
  return Boolean(input.session.assembleContext);
}

export async function assembleSessionContext(
  session: AgentSession,
  options: AgentContextOptions,
): Promise<Message[] | ContextReadBudgetExceededError> {
  try {
    await session.compactContext?.(options);
    return (await session.assembleContext?.(options)) ?? [];
  } catch (error) {
    if (error instanceof ContextReadBudgetExceededError && error.scope === 'messages') return error;
    throw error;
  }
}
