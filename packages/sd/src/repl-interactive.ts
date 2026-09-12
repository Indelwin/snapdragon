import { createInterface } from 'node:readline/promises';
import type { PendingAttachment } from './attachments.js';
import { commandEndsRun } from './command-types.js';
import { type CommandResult, handleCommand } from './commands.js';
import type { SdRestartRequest } from './reload.js';
import { replHeader } from './repl-header.js';
import { defaultIo, type SdIo } from './repl-io.js';
import { askReplQuestion } from './repl-question.js';
import { runCommandPrompt, runOneShot } from './repl-run-once.js';
import type { SdRuntime } from './runtime.js';

export async function runInteractive(
  runtime: SdRuntime,
  io: SdIo = defaultIo,
  signal?: AbortSignal,
): Promise<SdRestartRequest | undefined> {
  const rl = createInterface({ input: io.input, output: io.output });
  let attachments: PendingAttachment[] = [];
  io.output.write(replHeader(runtime));
  try {
    while (true) {
      if (signal?.aborted) return undefined;
      const line = await askReplQuestion(rl, signal);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('/')) {
        const result = await tryCommand(trimmed, runtime, attachments, io);
        attachments = result.attachments;
        if (result.prompt) await runCommandPrompt(runtime, result.prompt, io, signal);
        if (commandEndsRun(result)) return result.restart;
        continue;
      }

      try {
        await runOneShot(runtime, trimmed, attachments, io, { signal });
        attachments = [];
      } catch (error) {
        if (signal?.aborted) return undefined;
        io.error.write(`${errorMessage(error)}\n`);
      }
    }
  } finally {
    rl.close();
  }
}

async function tryCommand(
  line: string,
  runtime: SdRuntime,
  attachments: PendingAttachment[],
  io: SdIo,
): Promise<CommandResult> {
  try {
    return await handleCommand(line, runtime, attachments, io);
  } catch (error) {
    io.error.write(`${errorMessage(error)}\n`);
    return { quit: false, attachments };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
