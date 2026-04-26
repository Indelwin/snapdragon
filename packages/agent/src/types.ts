import type {
  LlmChatResponse,
  Message,
  MessageContent,
  Profile,
  StreamingChatHandler,
  ToolCall,
} from '@snapdragon-ai/host';
import type { ToolRegistry, ToolRegistryOptions, Toolset } from '@snapdragon-ai/tools';

export type AgentEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'message'; message: Message }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_end'; call: ToolCall; content: string; isError: boolean }
  | { type: 'run_end'; runId: string; response: LlmChatResponse };

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

export interface AgentSession {
  appendMessage(message: Message): unknown | Promise<unknown>;
  messages(): Message[];
}

export interface AgentOptions {
  provider: StreamingChatHandler;
  cwd?: string;
  systemPrompt?: string;
  tools?: ToolRegistry | Toolset[];
  session?: AgentSession;
  profile?: Profile;
  maxTurns?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface PromptOptions {
  runId?: string;
  signal?: AbortSignal;
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
  temperature?: number;
  maxTokens?: number;
  session?: AgentSession;
}

export type AgentPromptInput = MessageContent;
