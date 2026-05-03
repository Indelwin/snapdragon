import type { LlmChatResponse } from '@snapdragon-ai/host';
import type { AgentPromptState } from './agent-prompt-types.js';

export async function appendRunMeta(
  state: AgentPromptState,
  run: Record<string, unknown>,
): Promise<void> {
  await state.appendMeta?.({ run });
}

export function startedRun(runId: string, startedAt: string): Record<string, unknown> {
  return { id: runId, status: 'started', started_at: startedAt };
}

export function finishedRun(
  runId: string,
  startedAt: string,
  turn: number,
  response: LlmChatResponse,
): Record<string, unknown> {
  return {
    id: runId,
    status: 'finished',
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    turns: turn + 1,
    finish_reason: response.finish_reason,
    tokens_in: response.tokens_in,
    tokens_out: response.tokens_out,
  };
}

export function failedRun(
  runId: string,
  startedAt: string,
  turn: number,
  error: unknown,
  aborted: boolean,
): Record<string, unknown> {
  return {
    id: runId,
    status: aborted ? 'aborted' : 'error',
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    turns: turn,
    error: errorMessage(error),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
