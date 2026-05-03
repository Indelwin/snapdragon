import type { Message } from '@snapdragon-ai/host';
import type { AgentContextOptions } from './agent-context-options.js';

export interface AgentSession {
  appendMessage(message: Message): unknown | Promise<unknown>;
  appendMeta?(meta: Record<string, unknown>): unknown | Promise<unknown>;
  messages(): Message[];
  assembleContext?(options: AgentContextOptions): Message[] | Promise<Message[]>;
  compactContext?(options: AgentContextOptions): unknown | Promise<unknown>;
}
