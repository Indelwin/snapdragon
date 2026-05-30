import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { sendPiRpcCommand, stopPiProcess, writeJsonLine } from './pi-rpc-io.js';
import { parseJsonLine } from './pi-rpc-json.js';
import {
  DEFAULT_SHUTDOWN_GRACE_MS,
  type PiRpcResponse,
  type PiRpcRuntimeOptions,
  type PiRpcSession,
} from './pi-rpc-types.js';

const STDERR_TAIL_LIMIT = 8_192;

export function createPiRpcSession(
  child: ChildProcessWithoutNullStreams,
  options: PiRpcRuntimeOptions,
): PiRpcSession {
  const listeners = new Set<(event: Record<string, unknown>) => void>();
  const pending = new Map<string, (response: PiRpcResponse) => void>();
  const state = { stderr: '', processError: undefined as Error | undefined };
  const settlePending = (error: string) => settlePendingResponses(pending, error);

  child.stderr.on('data', (chunk) => {
    state.stderr = `${state.stderr}${chunk.toString('utf8')}`.slice(-STDERR_TAIL_LIMIT);
  });
  child.on('error', (error) => {
    state.processError = error;
    settlePending(error.message);
  });
  child.on('exit', () => {
    settlePending(state.stderr.trim() || `Pi RPC process exited before responding`);
  });
  createInterface({ input: child.stdout }).on('line', (line) => {
    dispatchJsonLine(line, pending, listeners);
  });

  return {
    child,
    send(command) {
      return sendPiRpcCommand(child, command, pending, state.processError);
    },
    write(message) {
      writeJsonLine(child, message);
    },
    async stop() {
      return stopPiProcess(child, options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS);
    },
    onEvent(listener) {
      listeners.add(listener);
    },
  };
}

function dispatchJsonLine(
  line: string,
  pending: Map<string, (response: PiRpcResponse) => void>,
  listeners: Set<(event: Record<string, unknown>) => void>,
): void {
  const parsed = parseJsonLine(line);
  if (!parsed) return;
  if (parsed.type === 'response' && typeof parsed.id === 'string') {
    resolvePendingResponse(parsed, pending);
    return;
  }
  for (const listener of listeners) listener(parsed);
}

function resolvePendingResponse(
  parsed: Record<string, unknown>,
  pending: Map<string, (response: PiRpcResponse) => void>,
): void {
  const resolvePending = pending.get(String(parsed.id));
  if (!resolvePending) return;
  pending.delete(String(parsed.id));
  resolvePending(parsed as PiRpcResponse);
}

function settlePendingResponses(
  pending: Map<string, (response: PiRpcResponse) => void>,
  error: string,
): void {
  for (const resolvePending of pending.values()) {
    resolvePending({ success: false, error });
  }
  pending.clear();
}
