import type { LlmChatResponse, Message, StreamEvent, ToolCall } from '@snapdragon-ai/host';

export type AgentEvent =
  | { type: 'run_start'; runId: string }
  | { type: 'provider_event'; event: StreamEvent }
  | { type: 'message'; message: Message }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_end'; call: ToolCall; content: string; isError: boolean }
  | { type: 'run_end'; runId: string; response: LlmChatResponse };

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

export function emitProviderEvent(
  listeners: Iterable<AgentEventListener>,
  event: StreamEvent,
): void {
  for (const listener of listeners) {
    void Promise.resolve(listener({ type: 'provider_event', event })).catch(() => undefined);
  }
}
