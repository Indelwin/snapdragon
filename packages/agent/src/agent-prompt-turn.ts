import type { LlmChatResponse, Message, ToolCall } from '@snapdragon-ai/host';
import type { AgentPromptState } from './agent-prompt-types.js';
import { emitProviderEvent } from './events.js';
import { emptyResponseMessage, isEmptyContent } from './response-content.js';
import { parseToolArgs } from './tool-args.js';
import { clampToolResult } from './tool-result.js';

export async function appendAssistantResponse(
  state: AgentPromptState,
  response: LlmChatResponse,
  runId: string,
): Promise<boolean> {
  const assistantMessage: Message = {
    role: 'assistant',
    content: response.content,
    tool_calls: response.tool_calls,
    thinking: response.thinking,
  };
  await state.appendMessage(assistantMessage);
  await state.emit({ type: 'message', message: assistantMessage });

  if (response.tool_calls && response.tool_calls.length > 0) return false;
  if (isEmptyContent(response.content)) {
    emitProviderEvent(state.agent.listeners, {
      kind: 'error',
      run_id: runId,
      provider: 'agent',
      message: emptyResponseMessage(response.finish_reason, response.thinking),
    });
  }
  await state.emit({ type: 'run_end', runId, response });
  return true;
}

export async function appendToolResults(
  state: AgentPromptState,
  calls: readonly ToolCall[],
  signal: AbortSignal | undefined,
): Promise<void> {
  for (const call of calls) await appendToolResult(state, call, signal);
}

async function appendToolResult(
  state: AgentPromptState,
  call: ToolCall,
  signal: AbortSignal | undefined,
): Promise<void> {
  await state.emit({ type: 'tool_start', call });
  const result = await state.agent.registry.invoke(call.name, parseToolArgs(call.args_json), {
    cwd: state.agent.cwd,
    signal,
  });
  const toolContent = clampToolResult(result.content, state.maxToolResultBytes);
  const toolMessage: Message = { role: 'tool', content: toolContent, tool_call_id: call.id };
  await state.appendMessage(toolMessage);
  await state.emit({ type: 'message', message: toolMessage });
  await state.emit({
    type: 'tool_end',
    call,
    content: toolContent,
    isError: result.isError === true,
  });
}
