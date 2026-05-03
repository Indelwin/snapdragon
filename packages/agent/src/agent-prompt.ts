import type { LlmChatResponse, Message } from '@snapdragon-ai/host';
import { appendAssistantResponse, appendToolResults } from './agent-prompt-turn.js';
import type { AgentPromptState } from './agent-prompt-types.js';
import { appendRunMeta, failedRun, finishedRun, startedRun } from './agent-run-meta.js';
import type { AgentPromptInput, PromptOptions } from './types.js';

export async function runAgentPrompt(
  state: AgentPromptState,
  input: AgentPromptInput,
  options: PromptOptions = {},
): Promise<LlmChatResponse> {
  const runId = options.runId ?? `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = new Date().toISOString();
  let turn = 0;
  await appendRunMeta(state, startedRun(runId, startedAt));
  await state.emit({ type: 'run_start', runId });
  const userMessage: Message = { role: 'user', content: input };
  const requestUserMessage: Message =
    options.requestInput === undefined
      ? userMessage
      : { ...userMessage, content: options.requestInput };
  await state.appendMessage(userMessage);
  await state.emit({ type: 'message', message: userMessage });

  try {
    for (; turn < state.maxTurns; turn += 1) {
      if (options.signal?.aborted) throw new Error('Agent run aborted');

      const tools = state.agent.registry.listDefinitions();
      const response = await state.sendProviderRequest(
        { visible: userMessage, request: requestUserMessage },
        tools,
        runId,
      );

      const done = await appendAssistantResponse(state, response, runId);
      if (done) {
        await appendRunMeta(state, finishedRun(runId, startedAt, turn, response));
        return response;
      }

      await appendToolResults(state, response.tool_calls ?? [], options.signal);
    }

    throw new Error(`Agent exceeded maxTurns=${state.maxTurns}`);
  } catch (error) {
    await appendRunMeta(
      state,
      failedRun(runId, startedAt, turn, error, options.signal?.aborted === true),
    );
    throw error;
  }
}
