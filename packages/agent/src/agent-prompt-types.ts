import type { LlmChatResponse, Message, ToolDefinition } from '@snapdragon-ai/host';
import type { ToolRegistry } from '@snapdragon-ai/tools';
import type { AgentEvent, AgentEventListener } from './events.js';
import type { AgentSession } from './types.js';

export interface AgentPromptRuntime {
  cwd: string;
  messages: Message[];
  listeners: Set<AgentEventListener>;
  registry: ToolRegistry;
}

export interface AgentPromptState {
  readonly agent: AgentPromptRuntime;
  readonly maxTurns: number;
  readonly maxToolResultBytes: number;
  readonly maxToolCallArgsBytes: number;
  appendMessage(message: Message): Promise<void>;
  appendMeta?(meta: Record<string, unknown>): unknown | Promise<unknown>;
  emit(event: AgentEvent): Promise<void>;
  sendProviderRequest(
    replacement: { visible: Message; request: Message },
    tools: ToolDefinition[],
    runId: string,
  ): Promise<LlmChatResponse>;
}

export interface AgentMessageState {
  messages: Message[];
  session?: AgentSession;
  maxInMemoryMessages?: number;
}
