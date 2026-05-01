import type { LlmChatResponse, Message } from '@snapdragon-ai/host';
import type { AgentPromptState } from './agent-prompt-types.js';
import { emitProviderEvent } from './events.js';
import { emptyResponseMessage, isEmptyContent } from './response-content.js';
import { parseToolArgs } from './tool-args.js';
import { clampToolResult } from './tool-result.js';
import type { AgentPromptInput, PromptOptions } from './types.js';

export async function runAgentPrompt(
  state: AgentPromptState,
  input: AgentPromptInput,
  options: PromptOptions = {},
): Promise<LlmChatResponse> {
  const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await state.emit({ type: 'run_start', runId });
  const userMessage: Message = { role: 'user', content: input };
  const requestUserMessage: Message =
    options.requestInput === undefined
      ? userMessage
      : { ...userMessage, content: options.requestInput };
  await state.appendMessage(userMessage);
  await state.emit({ type: 'message', message: userMessage });

  for (let turn = 0; turn < state.maxTurns; turn += 1) {
    if (options.signal?.aborted) throw new Error('Agent run aborted');

    const tools = state.agent.registry.listDefinitions();
    const response = await state.sendProviderRequest(
      { visible: userMessage, request: requestUserMessage },
      tools,
      runId,
    );

    await appendAssistantResponse(state, response, runId);
    if (!response.tool_calls || response.tool_calls.length === 0) return response;

    for (const call of response.tool_calls) {
      await state.emit({ type: 'tool_start', call });
      const result = await state.agent.registry.invoke(call.name, parseToolArgs(call.args_json), {
        cwd: state.agent.cwd,
        signal: options.signal,
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
  }

  throw new Error(`Agent exceeded maxTurns=${state.maxTurns}`);
}

async function appendAssistantResponse(
  state: AgentPromptState,
  response: LlmChatResponse,
  runId: string,
): Promise<void> {
  const assistantMessage: Message = {
    role: 'assistant',
    content: response.content,
    tool_calls: response.tool_calls,
    thinking: response.thinking,
  };
  await state.appendMessage(assistantMessage);
  await state.emit({ type: 'message', message: assistantMessage });

  if (response.tool_calls && response.tool_calls.length > 0) return;
  if (isEmptyContent(response.content)) {
    emitProviderEvent(state.agent.listeners, {
      kind: 'error',
      run_id: runId,
      provider: 'agent',
      message: emptyResponseMessage(response.finish_reason, response.thinking),
    });
  }
  await state.emit({ type: 'run_end', runId, response });
}
