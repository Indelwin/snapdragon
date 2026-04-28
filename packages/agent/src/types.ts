import type { Message, MessageContent, Profile, StreamingChatHandler } from '@snapdragon-ai/host';
import type { ToolRegistry, ToolRegistryOptions, Toolset } from '@snapdragon-ai/tools';

export type { AgentEvent, AgentEventListener } from './events.js';

export interface AgentSession {
  appendMessage(message: Message): unknown | Promise<unknown>;
  messages(): Message[];
  assembleContext?(options: AgentContextOptions): Message[] | Promise<Message[]>;
  compactContext?(options: AgentContextOptions): unknown | Promise<unknown>;
}

export interface AgentContextOptions {
  enabled?: boolean;
  freshTailCount?: number;
  maxRequestTokens?: number;
  chunkTargetTokens?: number;
  summaryTargetTokens?: number;
  minChunkMessages?: number;
  maxCompactionPasses?: number;
}

export interface AgentOptions {
  provider: StreamingChatHandler;
  cwd?: string;
  systemPrompt?: string;
  tools?: ToolRegistry | Toolset[];
  session?: AgentSession;
  profile?: Profile;
  maxTurns?: number;
  maxToolResultBytes?: number;
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
  context?: AgentContextOptions;
  temperature?: number;
  maxTokens?: number;
  session?: AgentSession;
}

export type AgentPromptInput = MessageContent;
