import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { PiRpcSessionState } from './pi-rpc-session-state.js';
import { stopPiProcess } from './pi-rpc-stop.js';

export async function stopPiRpcSession(
  child: ChildProcessWithoutNullStreams,
  shutdownGraceMs: number,
  state: PiRpcSessionState,
  pump: Promise<void>,
): Promise<void> {
  state.stopping = true;
  const stopError = new Error('Pi RPC session stopped');
  state.processError ??= stopError;
  state.reportError(stopError);
  state.observerAbort.abort(stopError);
  child.stdout.destroy();
  try {
    await stopPiProcess(child, shutdownGraceMs);
  } finally {
    await pump;
    state.clearListeners();
  }
}
