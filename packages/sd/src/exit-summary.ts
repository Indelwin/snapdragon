import type { SdRuntime } from './runtime.js';
import { type SdSessionSummary, summarizeSession } from './session-summary.js';
import { ensureSessionTitle } from './session-title.js';

export interface ExitSummaryOptions {
  command?: string;
}

export async function writeExitSummary(
  runtime: SdRuntime,
  output: NodeJS.WritableStream,
  options: ExitSummaryOptions = {},
): Promise<void> {
  if (!runtime.session) return;
  await ensureSessionTitle(runtime).catch(() => undefined);
  const summary = summarizeSession(runtime.session);
  if (summary.messages === 0) return;
  output.write(renderExitSummary(summary, options));
}

export function renderExitSummary(
  summary: SdSessionSummary,
  options: ExitSummaryOptions = {},
): string {
  const command = options.command ?? 'sd';
  const resume = `${command} --session ${shellQuote(summary.id)} --resume`;
  return [
    '',
    'Resume this session with:',
    `  ${resume}`,
    '',
    label('Session', summary.id),
    label('Title', summary.title ?? 'Untitled session'),
    label('Duration', formatDuration(summary.durationSeconds)),
    label(
      'Messages',
      `${summary.messages} (${summary.userMessages} user, ${summary.toolCalls} tool calls)`,
    ),
    '',
  ].join('\n');
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function label(name: string, value: string): string {
  return `${name.padEnd(15)} ${value}`;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9._:@%+=,/-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
