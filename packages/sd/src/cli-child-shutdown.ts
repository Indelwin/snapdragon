import { constants } from 'node:os';
import type { SupervisorSignal, SupervisorSignalSource } from './cli-child-signals.js';

export interface SupervisedChildShutdown {
  signal: AbortSignal;
  exitCode(): number | undefined;
  dispose(): void;
}

export function attachSupervisedChildShutdown(
  source: SupervisorSignalSource = process,
): SupervisedChildShutdown {
  // OS signals terminate the supervised child through normal mode/runtime disposal.
  // Raw-mode Ctrl-C is handled separately as TUI input and does not emit this signal.
  const controller = new AbortController();
  let received: SupervisorSignal | undefined;
  const handlers = signalHandlers((signal) => {
    if (received) return;
    received = signal;
    controller.abort(signalAbortError(signal));
  });
  for (const [signal, handler] of handlers) source.on(signal, handler);
  return {
    signal: controller.signal,
    exitCode: () => (received ? 128 + constants.signals[received] : undefined),
    dispose: () => {
      for (const [signal, handler] of handlers) source.removeListener(signal, handler);
    },
  };
}

function signalHandlers(
  receive: (signal: SupervisorSignal) => void,
): Array<[SupervisorSignal, () => void]> {
  return (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => [
    signal,
    () => receive(signal),
  ]);
}

function signalAbortError(signal: SupervisorSignal): Error {
  const error = new Error(`Received ${signal}; shutting down.`);
  error.name = 'AbortError';
  return error;
}
