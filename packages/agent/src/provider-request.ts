import type {
  LlmChatRequest,
  LlmChatResponse,
  Message,
  Profile,
  ReasoningRequest,
  StreamingChatHandler,
  ToolDefinition,
} from '@snapdragon-ai/host';
import { type AgentEventListener, emitProviderEvent } from './events.js';
import { sleep, transientProviderRetryDelayMs } from './provider-retry.js';
import { assembleProviderRequestMessages } from './request-context.js';
import { shouldRetryContextWindow } from './request-context-error.js';
import type { RequestReplacement } from './request-context-messages.js';
import type { AgentContextOptions, AgentSession } from './types.js';

export interface ProviderRequestState {
  provider: StreamingChatHandler;
  listeners: Set<AgentEventListener>;
  profile?: Profile;
  context?: AgentContextOptions;
  session?: AgentSession;
  fallbackMessages: Message[];
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: ReasoningRequest;
}

export async function sendProviderRequest(
  state: ProviderRequestState,
  replacement: RequestReplacement,
  tools: ToolDefinition[],
  runId: string,
): Promise<LlmChatResponse> {
  let pressure = 0;
  let transientAttempt = 0;
  while (true) {
    try {
      return await state.provider(await providerRequestBody(state, replacement, tools, pressure), {
        runId,
        profile: state.profile,
        emit: (event) => emitProviderEvent(state.listeners, event),
      });
    } catch (error) {
      if (shouldRetryContextWindow(error, pressure)) {
        pressure += 1;
        continue;
      }
      const delay = transientProviderRetryDelayMs(error, transientAttempt);
      if (delay === undefined) throw error;
      transientAttempt += 1;
      await sleep(delay);
    }
  }
}

async function providerRequestBody(
  state: ProviderRequestState,
  replacement: RequestReplacement,
  tools: ToolDefinition[],
  pressure: number,
): Promise<LlmChatRequest> {
  return {
    role: 'assistant',
    messages: await requestMessages(state, replacement, tools, pressure),
    tools,
    tool_choice: tools.length > 0 ? 'auto' : 'none',
    temperature: state.temperature,
    max_tokens: state.maxTokens,
    reasoning: state.reasoning,
  };
}

function systemMessages(systemPrompt: string): Message[] {
  return systemPrompt.length > 0 ? [{ role: 'system', content: systemPrompt }] : [];
}

function requestMessages(
  state: ProviderRequestState,
  replacement: RequestReplacement,
  tools: ToolDefinition[],
  pressure: number,
): Promise<Message[]> {
  return assembleProviderRequestMessages({
    context: state.context,
    fallbackMessages: state.fallbackMessages,
    replacement,
    session: state.session,
    systemMessages: systemMessages(state.systemPrompt),
    tools,
    pressure,
  });
}
