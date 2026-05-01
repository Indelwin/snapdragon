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
