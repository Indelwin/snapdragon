import type { SdRuntime } from '../runtime.js';
import { listSessions } from '../runtime-transitions.js';
import type { PromptCompletionCatalog } from './input-completion.js';

export function sessionCompletionCatalog(runtime: SdRuntime): PromptCompletionCatalog {
  const currentSessionId = activeSessionId(runtime);
  return {
    sessions: listSessions(runtime).map((session) => ({
      id: session.session_id,
      active: session.session_id === currentSessionId,
      updatedAt: session.updated_at,
    })),
  };
}

function activeSessionId(runtime: SdRuntime): string | undefined {
  if (!runtime.session) return undefined;
  return runtime.session.sessionId;
}
