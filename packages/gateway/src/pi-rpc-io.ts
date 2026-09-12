import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { requestId } from './pi-rpc-output.js';
import { DEFAULT_TIMEOUT_MS, type PiRpcResponse } from './pi-rpc-types.js';

export { stopPiProcess } from './pi-rpc-stop.js';

export function sendPiRpcCommand(
  child: ChildProcessWithoutNullStreams,
  command: Record<string, unknown>,
  pending: Map<string, (response: PiRpcResponse) => void>,
  processError: Error | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PiRpcResponse> {
  const id = typeof command.id === 'string' ? command.id : requestId(String(command.type ?? 'rpc'));
  const error = blockedSendError(child, processError);
  if (error) return Promise.resolve({ id, success: false, error });
  if (pending.has(id))
    return Promise.resolve({ id, success: false, error: 'Duplicate Pi RPC request id' });
  return new Promise<PiRpcResponse>((resolvePending) => {
    const finish = (response: PiRpcResponse) => {
      clearTimeout(timer);
      pending.delete(id);
      resolvePending(response);
    };
    const timer = setTimeout(
      () =>
        finish({
          id,
          success: false,
          error: `Pi RPC request timed out after ${timeoutMs}ms`,
        }),
      timeoutMs,
    );
    pending.set(id, finish);
    try {
      writeJsonLine(child, { ...command, id });
    } catch (cause) {
      finish({ id, success: false, error: String(cause) });
    }
  });
}

export function writeJsonLine(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>,
): void {
  if (child.stdin.destroyed || !child.stdin.writable) return;
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function blockedSendError(
  child: ChildProcessWithoutNullStreams,
  processError: Error | undefined,
): string | undefined {
  if (processError) return processError.message;
  if (child.stdin.destroyed || !child.stdin.writable) return 'Pi RPC stdin is closed';
  if (child.exitCode !== null || child.signalCode !== null) return 'Pi RPC process already exited';
  return undefined;
}
