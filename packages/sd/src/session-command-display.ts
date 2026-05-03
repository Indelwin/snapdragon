import { formatDuration } from './exit-summary.js';
import type { SdRuntime } from './runtime.js';
import { listSessions } from './runtime-session-transitions.js';
import { summaryForSession } from './session-info.js';
import { summarizeSession } from './session-summary.js';

export function sessionCommandSummary(command: string, runtime: SdRuntime): string {
  return command === '/session'
    ? currentSessionSummary(runtime)
    : persistedSessionsSummary(runtime);
}

export function currentSessionSummary(runtime: SdRuntime): string {
  if (!runtime.session) return 'Sessions are disabled for this run.';
  const summary = summarizeSession(runtime.session);
  return [
    `id: ${runtime.session.sessionId}`,
    `title: ${summary.title ?? 'Untitled session'}`,
    `duration: ${formatDuration(summary.durationSeconds)}`,
    `path: ${runtime.session.jsonlPath}`,
    `messages: ${summary.messages} (${summary.userMessages} user, ${summary.toolCalls} tool calls)`,
  ].join('\n');
}

export function persistedSessionsSummary(runtime: SdRuntime): string {
  const sessions = listSessions(runtime);
  if (sessions.length === 0) return 'No sessions found.';
  return ['Sessions:', ...sessions.map((session) => sessionLine(runtime, session))].join('\n');
}

function sessionLine(
  runtime: SdRuntime,
  session: { session_id: string; updated_at: number; jsonl_size: number },
): string {
  const active = runtime.session?.sessionId === session.session_id ? '*' : ' ';
  const updated = new Date(session.updated_at * 1000).toISOString();
  return `${active} ${session.session_id} ${updated} ${session.jsonl_size} bytes${titleSuffix(runtime, session.session_id)}`;
}

function titleSuffix(runtime: SdRuntime, sessionId: string): string {
  const title = summaryForSession(runtime.config, sessionId)?.title;
  return title ? ` - ${title}` : '';
}
