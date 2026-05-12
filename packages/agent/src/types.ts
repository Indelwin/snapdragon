import type { MessageContent, Profile, StreamingChatHandler } from '@snapdragon-ai/host';
import type { ToolRegistry, ToolRegistryOptions, Toolset } from '@snapdragon-ai/tools';
import type { AgentContextOptions } from './agent-context-options.js';
import type { AgentSession } from './agent-session.js';

export type { AgentContextOptions } from './agent-context-options.js';
export type { AgentSession } from './agent-session.js';
export type { AgentEvent, AgentEventListener } from './events.js';

export interface AgentOptions {
  provider: StreamingChatHandler;
  cwd?: string;
  systemPrompt?: string;
  tools?: ToolRegistry | Toolset[];
  session?: AgentSession;
  profile?: Profile;
  maxTurns?: number;
  maxToolResultBytes?: number;
  maxToolCallArgsBytes?: number;
  context?: AgentContextOptions;
  temperature?: number;
  maxTokens?: number;
}

export interface PromptOptions {
  runId?: string;
  signal?: AbortSignal;
  requestInput?: AgentPromptInput;
}

export interface CodingAgentOptions extends Omit<AgentOptions, 'tools'> {
  codingTools?: Omit<ToolRegistryOptions, 'cwd'>;
}

export interface SnapdragonAgentArgs {
  provider: StreamingChatHandler;
  cwd: string;
  registry: ToolRegistry;
  systemPrompt: string;
  profile?: Profile;
  maxTurns: number;
  maxToolResultBytes: number;
  maxToolCallArgsBytes: number;
  context?: AgentContextOptions;
  temperature?: number;
  maxTokens?: number;
  session?: AgentSession;
}

export type AgentPromptInput = MessageContent;
