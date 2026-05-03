import type { PendingAttachment } from './attachments.js';
import type { SdRuntime } from './runtime.js';
import {
  deleteRuntimeSession,
  newRuntimeSession,
  resumeRuntimeSession,
} from './runtime-session-transitions.js';
import { withRuntimeWarnings } from './runtime-warnings.js';

interface CommandResult {
  quit: boolean;
  attachments: PendingAttachment[];
}

interface CommandIo {
  output: NodeJS.WritableStream;
}

export async function resumeSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: CommandIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  const session = await resumeRuntimeSession(runtime, arg || undefined);
  return writeCommandResult(
    io,
    withRuntimeWarnings(`Resumed session ${session.sessionId}.`, runtime),
    attachments,
  );
}

export async function newSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: CommandIo,
  attachments: PendingAttachment[],
): Promise<CommandResult> {
  const session = await newRuntimeSession(runtime, arg || undefined);
  return writeCommandResult(io, `Started session ${session.sessionId}.`, attachments);
}

export function deleteSessionCommand(
  arg: string,
  runtime: SdRuntime,
  io: CommandIo,
  attachments: PendingAttachment[],
): CommandResult {
  if (!arg) return writeCommandResult(io, 'Usage: /delete-session <id>', attachments);
  const deleted = deleteRuntimeSession(runtime, arg);
  return writeCommandResult(
    io,
    deleted ? `Deleted session ${arg}.` : `Session not found: ${arg}.`,
    attachments,
  );
}

function writeCommandResult(
  io: CommandIo,
  text: string,
  attachments: PendingAttachment[],
): CommandResult {
  io.output.write(`${text}\n`);
  return { quit: false, attachments };
}
