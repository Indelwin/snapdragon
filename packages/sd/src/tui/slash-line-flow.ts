import { type CommandResult, handleCommand } from '../commands.js';
import { runCommandPrompt } from '../repl.js';
import { isRuntimeTransitionCommand, isTranscriptResetCommand } from './slash-line-guards.js';
import { errorMessage, memoryIo } from './slash-line-io.js';
import type { RunSlashLineArgs } from './slash-line-types.js';

export async function runHandleCommandFlow(args: RunSlashLineArgs): Promise<void> {
  const capture = memoryIo();
  let taskActive = false;
  const progress = (label: string) => {
    if (taskActive) args.controller.updateTask(label);
    else {
      args.controller.beginTask(label);
      taskActive = true;
    }
  };
  let result: CommandResult;
  try {
    result = await handleCommand(args.line, args.runtime, args.attachmentsRef.current, capture.io, {
      progress,
    });
  } catch (error) {
    args.controller.appendCommandOutput(errorMessage(error), 'error');
    return;
  } finally {
    if (taskActive) args.controller.endTask();
  }
  await applySlashCommandResult(args, result, capture);
}

async function applySlashCommandResult(
  args: RunSlashLineArgs,
  result: CommandResult,
  capture: ReturnType<typeof memoryIo>,
): Promise<void> {
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
  if (isRuntimeTransitionCommand(args.line)) args.controller.refreshRuntimeStatus();
  if (result.quit) args.exit();
}
