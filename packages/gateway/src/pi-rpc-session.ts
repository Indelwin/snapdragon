import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { sendPiRpcCommand, writeJsonLine } from './pi-rpc-io.js';
import { pumpPiRpcLines } from './pi-rpc-session-pump.js';
import { PiRpcSessionState } from './pi-rpc-session-state.js';
import { stopPiRpcSession } from './pi-rpc-session-stop.js';
import {
  DEFAULT_PI_MAX_LINE_BYTES,
  DEFAULT_SHUTDOWN_GRACE_MS,
  type PiRpcRuntimeOptions,
  type PiRpcSession,
} from './pi-rpc-types.js';

export function createPiRpcSession(
  child: ChildProcessWithoutNullStreams,
  options: PiRpcRuntimeOptions,
): PiRpcSession {
  const state = new PiRpcSessionState();
  let stopTask: Promise<void> | undefined;

  child.stderr.on('data', (chunk) => state.captureStderr(chunk));
  child.on('error', (error) => state.reportError(error));
  child.stdin.on('error', (error) => state.reportError(error));
  const pump = pumpPiRpcLines(
    child,
    options.maxLineBytes ?? DEFAULT_PI_MAX_LINE_BYTES,
    state.pending,
    state.listeners,
    state.observerAbort.signal,
  )
    .then(() => state.finishPump())
    .catch((cause: unknown) => state.failPump(child, cause));

  return {
    child,
    send(command) {
      return sendPiRpcCommand(child, command, state.pending, state.processError, options.timeoutMs);
    },
    write(message) {
      writeJsonLine(child, message);
    },
    stop() {
      stopTask ??= stopPiRpcSession(
        child,
        options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS,
        state,
        pump,
      );
      return stopTask;
    },
    onEvent(listener) {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    onError(listener) {
      return state.addErrorListener(listener);
    },
  };
}
