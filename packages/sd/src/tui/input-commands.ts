import { Writable } from 'node:stream';
import type { MutableRefObject } from 'react';
import { contentWithAttachments, type PendingAttachment } from '../attachments.js';
import { BUILTIN_SLASH_COMMANDS, type CommandResult, handleCommand } from '../commands.js';
import { defaultIo, runCommandPrompt, type SdIo } from '../repl.js';
import type { SdRuntime } from '../runtime.js';
import { matchCommandLine, type SdTuiCommand } from './commands.js';
import { runInlineShellCommand } from './inline-shell.js';
import type { PromptCompletionState } from './input-completion.js';
import { type PaletteState, rememberHistory } from './input-keymap.js';
import { type PromptSelection, selectionForLine } from './input-selection.js';
import type { SdUiController } from './ui.js';

export function defaultCommands(
  runSlashCommand: (line: string) => Promise<void>,
  runtime?: SdRuntime,
): SdTuiCommand[] {
  const commands = [
    command('/help', 'show slash commands', runSlashCommand),
    command('/clear', 'clear in-memory chat history', runSlashCommand),
    command('/session', 'show session details', runSlashCommand),
    command('/sessions', 'list sessions', runSlashCommand),
    command('/resume', 'resume a session', runSlashCommand, '[id]'),
    command('/new-session', 'start a new session', runSlashCommand, '[id]'),
    command('/delete-session', 'delete a session', runSlashCommand, '<id>'),
    command('/profiles', 'list profiles', runSlashCommand),
    command('/profile', 'show or switch profile', runSlashCommand, '[name|none]'),
    command('/tools', 'list enabled tools', runSlashCommand),
    command('/providers', 'list configured providers', runSlashCommand),
    command('/provider', 'show or switch provider', runSlashCommand, '<id> [model]'),
    command('/models', 'discover/list provider models', runSlashCommand, '[provider]'),
    command('/model', 'show or switch model', runSlashCommand, '<id>'),
    command('/attach', 'attach an image to the next prompt', runSlashCommand, '<path-or-url>'),
    command('/clear-attachments', 'clear pending attachments', runSlashCommand),
    command('/events', 'toggle events panel', runSlashCommand),
    command('/palette', 'open command palette', runSlashCommand),
    command('/quit', 'exit sd', runSlashCommand),
  ];
  const reserved = new Set(BUILTIN_SLASH_COMMANDS);
  for (const skill of runtime?.skills.list() ?? []) {
    if (reserved.has(skill.command)) continue;
    commands.push(command(skill.command, `skill: ${skill.description}`, runSlashCommand, '[task]'));
  }
  return commands;
}

export async function runSlashLine(args: {
  line: string;
  runtime: SdRuntime;
  controller: SdUiController;
  exit: () => void;
  attachmentsRef: MutableRefObject<PendingAttachment[]>;
  setAttachments: (attachments: PendingAttachment[]) => void;
  setPalette: (patch: Partial<PaletteState>) => void;
  openSelection?: (draft: string, completion: PromptCompletionState) => void;
}): Promise<void> {
  if (args.line === '/events') {
    toggleEvents(args.controller);
    return;
  }
  if (args.line === '/palette') {
    args.setPalette({ open: true, query: '', selectedIndex: 0 });
    return;
  }
  if (args.line === '/quit' || args.line === '/exit') {
    args.exit();
    return;
  }
  if (args.controller.isRunning && isRuntimeTransitionCommand(args.line)) {
    args.controller.appendCommandOutput('A run is already active.', 'error');
    return;
  }
  let selection: PromptSelection | undefined;
  try {
    selection = await selectionForLine(args.line, args.runtime);
  } catch (error) {
    args.controller.appendCommandOutput(errorMessage(error), 'error');
    return;
  }
  if (selection && args.openSelection) {
    args.openSelection(selection.draft, selection.completion);
    if (selection.warning) args.controller.appendCommandOutput(selection.warning, 'error');
    return;
  }

  const capture = memoryIo();
  let result: CommandResult;
  try {
    result = await handleCommand(args.line, args.runtime, args.attachmentsRef.current, capture.io);
  } catch (error) {
    args.controller.appendCommandOutput(errorMessage(error), 'error');
    return;
  }
  args.controller.bindRuntimeAgent();
  args.setAttachments(result.attachments);
  if (args.line === '/clear') args.controller.clearChat();
  if (isTranscriptResetCommand(args.line)) args.controller.loadRuntimeTranscript();
  args.controller.appendCommandOutput(capture.output());
  args.controller.appendCommandOutput(capture.error(), 'error');
  if (result.prompt) {
    try {
      args.controller.bindRuntimeAgent();
      await runCommandPrompt(args.runtime, result.prompt, capture.io);
    } catch (error) {
      args.controller.markRunError(error);
    }
  }
  if (args.line.startsWith('/provider') || args.line.startsWith('/model')) {
    args.controller.refreshRuntimeStatus();
  }
  if (isRuntimeStatusCommand(args.line)) args.controller.refreshRuntimeStatus();
  if (result.quit) args.exit();
}

export async function submitLine(args: {
  line: string;
  runtime: SdRuntime;
  controller: SdUiController;
  attachmentsRef: MutableRefObject<PendingAttachment[]>;
  historyRef: MutableRefObject<string[]>;
  commandsRef: MutableRefObject<SdTuiCommand[]>;
  setAttachments: (attachments: PendingAttachment[]) => void;
  runSlashCommand: (line: string) => Promise<void>;
}): Promise<void> {
  if (!args.line) return;
  if (args.controller.isRunning) {
    args.controller.appendCommandOutput('A run is already active.', 'error');
    return;
  }
  if (args.line.startsWith('/')) {
    await runEnteredCommand(args.line, args.commandsRef.current, args.runSlashCommand);
    return;
  }
  if (args.line.startsWith('!')) {
    await runInlineShellLine(args.line, args.runtime, args.controller, args.historyRef);
    return;
  }
  rememberHistory(args.line, args.historyRef, args.controller);
  const attachments = args.attachmentsRef.current;
  args.setAttachments([]);
  try {
    args.controller.bindRuntimeAgent();
    await args.runtime.agent.prompt(contentWithAttachments(args.line, attachments));
  } catch (error) {
    args.controller.markRunError(error);
  }
}

async function runInlineShellLine(
  line: string,
  runtime: SdRuntime,
  controller: SdUiController,
  historyRef: MutableRefObject<string[]>,
): Promise<void> {
  const command = line.slice(1).trim();
  if (!command) {
    controller.appendCommandOutput('Usage: !<shell command>', 'error');
    return;
  }
  rememberHistory(line, historyRef, controller);
  controller.appendCommandOutput(`$ ${command}`);
  const result = await runInlineShellCommand(command, { cwd: runtime.agent.cwd });
  controller.appendCommandOutput(result.content, result.isError ? 'error' : 'info');
}

export async function runPaletteCommand(
  paletteRef: MutableRefObject<PaletteState>,
  commandsRef: MutableRefObject<SdTuiCommand[]>,
  setPalette: (patch: Partial<PaletteState>) => void,
): Promise<void> {
  const palette = paletteRef.current;
  const selected = commandsRef.current[palette.selectedIndex];
  if (!selected) return;
  setPalette({ open: false, query: '', selectedIndex: 0 });
  const query = palette.query.trim();
  const match = query.startsWith('/') ? matchCommandLine(commandsRef.current, query) : undefined;
  if (match) await match.command.run(match.arg);
  else await selected.run();
}

function command(
  name: string,
  description: string,
  runSlashCommand: (line: string) => Promise<void>,
  argHint?: string,
): SdTuiCommand {
  return {
    name,
    description,
    argHint,
    run: (arg) => runSlashCommand(arg ? `${name} ${arg}` : name),
  };
}

async function runEnteredCommand(
  line: string,
  commands: readonly SdTuiCommand[],
  runSlashCommand: (line: string) => Promise<void>,
): Promise<void> {
  const match = matchCommandLine(commands, line);
  if (match) await match.command.run(match.arg);
  else await runSlashCommand(line);
}

function toggleEvents(controller: SdUiController): void {
  controller.toggleEventPanel();
  controller.appendCommandOutput('Toggled events panel.');
}

function isTranscriptResetCommand(line: string): boolean {
  return (
    line.startsWith('/resume') || line.startsWith('/new-session') || line.startsWith('/profile')
  );
}

function isRuntimeStatusCommand(line: string): boolean {
  return isTranscriptResetCommand(line) || line.startsWith('/delete-session');
}

function isRuntimeTransitionCommand(line: string): boolean {
  return (
    line.startsWith('/provider') ||
    line.startsWith('/model') ||
    line.startsWith('/resume') ||
    line.startsWith('/new-session') ||
    line.startsWith('/delete-session') ||
    line.startsWith('/profile')
  );
}

function memoryIo(): { io: SdIo; output(): string; error(): string } {
  let output = '';
  let error = '';
  return {
    io: {
      input: defaultIo.input,
      output: new Writable({
        write(chunk, _encoding, callback) {
          output += chunk.toString();
          callback();
        },
      }),
      error: new Writable({
        write(chunk, _encoding, callback) {
          error += chunk.toString();
          callback();
        },
      }),
    },
    output: () => output,
    error: () => error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
