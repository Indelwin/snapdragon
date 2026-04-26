import { attachmentFromReference, type PendingAttachment } from './attachments.js';
import type { SdIo } from './repl.js';
import type { SdRuntime } from './runtime.js';

export interface CommandResult {
  quit: boolean;
  attachments: PendingAttachment[];
}

export async function handleCommand(
  line: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  const [command = '', ...rest] = line.split(/\s+/);
  const arg = rest.join(' ').trim();
  if (command === '/quit' || command === '/exit') return { quit: true, attachments };
  if (command === '/help') return writeResult(io, slashHelp(), attachments);
  if (command === '/clear') return clearHistory(runtime, io, attachments);
  if (command === '/session') return writeResult(io, sessionSummary(runtime), attachments);
  if (command === '/tools') return writeResult(io, toolsSummary(runtime), attachments);
  if (command === '/provider') return writeResult(io, providerSummary(runtime), attachments);
  if (command === '/attach') return attachImage(arg, runtime, attachments, io);
  if (command === '/clear-attachments') {
    return writeResult(io, 'Cleared pending attachments.', []);
  }

  io.error.write(`Unknown command: ${command}\n`);
  return { quit: false, attachments };
}

function writeResult(io: SdIo, text: string, attachments: PendingAttachment[]): CommandResult {
  io.output.write(`${text}\n`);
  return { quit: false, attachments };
}

function clearHistory(
  runtime: SdRuntime,
  io: SdIo,
  attachments: PendingAttachment[],
): CommandResult {
  runtime.agent.messages.splice(0, runtime.agent.messages.length);
  return writeResult(io, 'Cleared in-memory chat history.', attachments);
}

async function attachImage(
  arg: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  const attachment = await attachmentFromReference(arg, runtime.agent.cwd);
  const next = [...attachments, attachment];
  return writeResult(io, `Attached ${attachment.label} (${next.length} pending).`, next);
}

function providerSummary(runtime: SdRuntime): string {
  return `${runtime.provider.id}/${runtime.provider.model} (${runtime.provider.kind})`;
}

function slashHelp(): string {
  return [
    'Commands:',
    '  /help                 Show commands',
    '  /quit                 Exit',
    '  /clear                Clear in-memory chat history',
    '  /session              Show session details',
    '  /tools                List enabled tools',
    '  /provider             Show active provider',
    '  /attach <path-or-url> Attach an image to the next prompt',
    '  /clear-attachments    Clear pending attachments',
  ].join('\n');
}

function sessionSummary(runtime: SdRuntime): string {
  if (!runtime.session) return 'Sessions are disabled for this run.';
  return [
    `id: ${runtime.session.sessionId}`,
    `path: ${runtime.session.jsonlPath}`,
    `messages: ${runtime.session.messages().length}`,
  ].join('\n');
}

function toolsSummary(runtime: SdRuntime): string {
  const toolsets = runtime.agent.registry
    .listToolsets()
    .map((toolset) => `${toolset.enabled ? '+' : '-'} ${toolset.name}`)
    .join('\n');
  const tools = runtime.agent.registry
    .listEnabled()
    .map((tool) => `  ${tool.name} (${tool.toolset})`)
    .join('\n');
  return [`Toolsets:`, toolsets || '  (none)', '', 'Tools:', tools || '  (none)'].join('\n');
}
