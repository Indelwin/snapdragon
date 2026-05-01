import type { Message } from '@snapdragon-ai/host';
import type { AgentMessageState } from './agent-prompt-types.js';
import type { AgentEvent } from './events.js';

export async function appendAgentMessage(
  args: AgentMessageState & { message: Message },
): Promise<void> {
  args.messages.push(args.message);
  await args.session?.appendMessage(args.message);
}

export async function emitAgentEvent(args: {
  listeners: Set<(event: AgentEvent) => void>;
  event: AgentEvent;
}): Promise<void> {
  for (const listener of args.listeners) listener(args.event);
}
