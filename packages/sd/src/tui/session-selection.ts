import type { SdRuntime } from '../runtime.js';
import { listSessions } from '../runtime-transitions.js';
import type { PromptCompletionState } from './input-completion.js';

export function sessionSelection(
  runtime: SdRuntime,
  command: '/resume' | '/delete-session',
): PromptCompletionState {
  const sessions = listSessions(runtime);
  return {
    mode: 'session',
    query: '',
    selectedIndex: selectedSessionIndex(sessions, runtime),
    suggestions: sessions.map((session) => ({
      label: session.session_id,
      description: sessionDescription(session, runtime),
      insertText: `${command} ${session.session_id}`,
      kind: 'session',
    })),
  };
}

function selectedSessionIndex(sessions: Array<{ session_id: string }>, runtime: SdRuntime): number {
  return Math.max(
    0,
    sessions.findIndex((session) => session.session_id === runtime.session?.sessionId),
  );
}

function sessionDescription(
  session: { session_id: string; updated_at: number; jsonl_size: number },
  runtime: SdRuntime,
): string {
  const active = session.session_id === runtime.session?.sessionId ? 'active' : '';
  const updated = new Date(session.updated_at * 1000).toISOString();
  return [active, updated, `${session.jsonl_size} bytes`].filter(Boolean).join(' ');
}
