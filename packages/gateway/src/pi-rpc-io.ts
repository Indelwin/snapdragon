import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { requestId } from './pi-rpc-output.js';
import type { PiRpcResponse } from './pi-rpc-types.js';

export function sendPiRpcCommand(
  child: ChildProcessWithoutNullStreams,
  command: Record<string, unknown>,
  pending: Map<string, (response: PiRpcResponse) => void>,
  processError: Error | undefined,
): Promise<PiRpcResponse> {
  const id = typeof command.id === 'string' ? command.id : requestId(String(command.type ?? 'rpc'));
  const error = blockedSendError(child, processError);
  if (error) return Promise.resolve({ id, success: false, error });
  return new Promise<PiRpcResponse>((resolvePending) => {
    pending.set(id, resolvePending);
    writeJsonLine(child, { id, ...command });
  });
}

export function writeJsonLine(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>,
): void {
  if (child.stdin.destroyed || !child.stdin.writable) return;
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

export async function stopPiProcess(
  child: ChildProcessWithoutNullStreams,
  shutdownGraceMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.stdin.end();
  await new Promise<void>((resolveStop) => {
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolveStop();
    }, shutdownGraceMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveStop();
    });
  });
}

function blockedSendError(
  child: ChildProcessWithoutNullStreams,
  processError: Error | undefined,
): string | undefined {
  if (processError) return processError.message;
  if (child.exitCode !== null || child.signalCode !== null) return 'Pi RPC process already exited';
  return undefined;
}
