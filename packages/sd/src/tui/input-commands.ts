import type { MutableRefObject } from 'react';
import { contentWithAttachments, type PendingAttachment } from '../attachments.js';
import { BUILTIN_SLASH_COMMANDS } from '../commands.js';
import { maybeAutoCaptureMemory, requestInputWithMemory } from '../memory.js';
import type { SdRuntime } from '../runtime.js';
import { matchCommandLine, type SdTuiCommand } from './commands.js';
import { runInlineShellCommand } from './inline-shell.js';
import { type PaletteState, rememberHistory } from './input-keymap.js';
import type { SdUiController } from './ui.js';

export { type RunSlashLineArgs, runSlashLine } from './slash-line.js';

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
    command('/memory', 'show or search memory', runSlashCommand, '[query]'),
    command('/remember', 'append memory note', runSlashCommand, '<note>'),
    command('/extensions', 'list or reload extensions', runSlashCommand, '[reload]'),
    command(
      '/reload',
      'hot-reload runtime (extensions, skills, profiles)',
      runSlashCommand,
      '[pull|build|sync]',
    ),
    command('/status', 'show agent state dashboard', runSlashCommand),
    command('/tools', 'list enabled tools', runSlashCommand),
    command('/providers', 'list configured providers', runSlashCommand),
    command('/provider', 'show or switch provider', runSlashCommand, '<id> [model]'),
    command('/models', 'discover/list provider models', runSlashCommand, '[provider]'),
    command('/model', 'show or switch model', runSlashCommand, '<id>'),
    command('/attach', 'attach an image to the next prompt', runSlashCommand, '<path-or-url>'),
    command('/clear-attachments', 'clear pending attachments', runSlashCommand),
    command('/paste', 'paste clipboard image (or echo text)', runSlashCommand, '[image|text]'),
    command('/events', 'toggle events panel', runSlashCommand),
    command('/tools-panel', 'toggle tools panel', runSlashCommand),
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
  // Tie this run to an AbortController so Esc (handled by the global keymap
  // via controller.abortActiveRun()) can cancel it without killing the
  // process. The controller clears its internal reference on run_end /
  // markRunError; we still abort()/clear here defensively in case the run
  // returns or throws before the controller saw run_end.
  const abort = new AbortController();
  args.controller.setActiveAbortController(abort);
  try {
    args.controller.bindRuntimeAgent();
    const visibleInput = contentWithAttachments(args.line, attachments);
    const response = await args.runtime.agent.prompt(visibleInput, {
      requestInput: await requestInputWithMemory(
        args.runtime.config,
        args.runtime.memory,
        visibleInput,
      ),
      signal: abort.signal,
    });
    await maybeAutoCaptureMemory({
      config: args.runtime.config,
      memory: args.runtime.memory,
      visibleInput,
      response,
      source: 'sd.tui',
      sessionAppendMeta: (meta) => args.runtime.session?.appendMeta(meta),
    });
  } catch (error) {
    args.controller.markRunError(error);
  } finally {
    args.controller.setActiveAbortController(undefined);
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
