import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { PiRpcEventListener } from './pi-rpc-session-pump.js';
import type { PiRpcResponse } from './pi-rpc-types.js';

const STDERR_TAIL_LIMIT = 8_192;

export class PiRpcSessionState {
  readonly listeners = new Set<PiRpcEventListener>();
  readonly errorListeners = new Set<(error: Error) => void>();
  readonly pending = new Map<string, (response: PiRpcResponse) => void>();
  readonly observerAbort = new AbortController();
  stderr = '';
  processError?: Error;
  stopping = false;

  captureStderr(chunk: unknown): void {
    this.stderr = `${this.stderr}${String(chunk)}`.slice(-STDERR_TAIL_LIMIT);
  }

  reportError(error: Error): void {
    this.processError ??= error;
    this.settlePending(error.message);
    for (const listener of [...this.errorListeners]) this.#notifyError(listener, error);
  }

  finishPump(): void {
    if (!this.stopping) {
      this.reportError(new Error(this.stderr.trim() || 'Pi RPC stdout EOF before completion'));
    }
  }

  failPump(child: ChildProcessWithoutNullStreams, cause: unknown): void {
    if (this.stopping) return;
    const error = cause instanceof Error ? cause : new Error(String(cause));
    this.reportError(error);
    this.observerAbort.abort(error);
    child.stdout.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }

  settlePending(error: string): void {
    for (const resolvePending of this.pending.values()) {
      resolvePending({ success: false, error });
    }
    this.pending.clear();
  }

  addErrorListener(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    if (this.processError) this.#notifyError(listener, this.processError);
    return () => this.errorListeners.delete(listener);
  }

  clearListeners(): void {
    this.listeners.clear();
    this.errorListeners.clear();
  }

  #notifyError(listener: (error: Error) => void, error: Error): void {
    try {
      listener(error);
    } catch {
      // Error observers are diagnostic only.
    }
  }
}
