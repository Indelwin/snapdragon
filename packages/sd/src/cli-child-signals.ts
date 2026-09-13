export type SupervisorSignal = 'SIGINT' | 'SIGTERM' | 'SIGHUP';

export interface SupervisorSignalSource {
  on(event: SupervisorSignal, listener: () => void): unknown;
  removeListener(event: SupervisorSignal, listener: () => void): unknown;
}

export interface SignalManagedChild {
  kill(signal: NodeJS.Signals): boolean;
}

export interface ChildSignalPolicy {
  groupDeliveryGraceMs: number;
  forceKillMs: number;
  onForceKillFailure(error: Error): void;
}

export function attachChildSignalPolicy(
  child: SignalManagedChild,
  source: SupervisorSignalSource,
  policy: ChildSignalPolicy,
): () => void {
  let forwardTimer: NodeJS.Timeout | undefined;
  let killTimer: NodeJS.Timeout | undefined;
  let terminating = false;
  const handlers = signalHandlers((signal) => {
    if (terminating) return;
    terminating = true;
    forwardTimer = setTimeout(
      () => signalChild(child, forwardedSignal(signal)),
      policy.groupDeliveryGraceMs,
    );
    killTimer = setTimeout(() => {
      const error = signalChild(child, 'SIGKILL');
      if (error) policy.onForceKillFailure(error);
    }, policy.forceKillMs);
  });
  for (const [signal, handler] of handlers) source.on(signal, handler);
  return () => {
    if (forwardTimer) clearTimeout(forwardTimer);
    if (killTimer) clearTimeout(killTimer);
    for (const [signal, handler] of handlers) source.removeListener(signal, handler);
  };
}

function signalHandlers(
  terminate: (signal: SupervisorSignal) => void,
): Array<[SupervisorSignal, () => void]> {
  return (['SIGINT', 'SIGTERM', 'SIGHUP'] as const).map((signal) => [
    signal,
    () => terminate(signal),
  ]);
}

function forwardedSignal(signal: SupervisorSignal): NodeJS.Signals {
  return signal === 'SIGINT' ? 'SIGTERM' : signal;
}

function signalChild(child: SignalManagedChild, signal: NodeJS.Signals): Error | undefined {
  try {
    return child.kill(signal) ? undefined : new Error(`Child rejected ${signal}.`);
  } catch (error) {
    return new Error(`Failed to signal child with ${signal}.`, { cause: error });
  }
}
