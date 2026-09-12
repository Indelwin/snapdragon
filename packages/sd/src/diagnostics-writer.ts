import { writeDiagnosticsSample } from './diagnostics-rotation.js';
import {
  diagnosticsPhase,
  diagnosticsSampleContext,
  type SdDiagnosticsSampleContext,
} from './diagnostics-sample.js';
import { diagnosticsWriterSettings } from './diagnostics-settings.js';
import type {
  SdDiagnosticsHandle,
  SdDiagnosticsOptions,
  SdDiagnosticsPhase,
} from './diagnostics-types.js';

export interface SdDiagnosticsWriterDependencies {
  writeSample?: typeof writeDiagnosticsSample;
}

export function startSdDiagnostics(
  options: SdDiagnosticsOptions = {},
  dependencies: SdDiagnosticsWriterDependencies = {},
): SdDiagnosticsHandle {
  if (!options.enabled || options.signal?.aborted) return disabledHandle();
  const settings = diagnosticsWriterSettings(options);
  const context = diagnosticsContext(options);
  const writeSample = dependencies.writeSample ?? writeDiagnosticsSample;
  let stopped = false;
  let sampleRequested = false;
  let drainPromise: Promise<void> | null = null;
  const enqueue = (): Promise<void> => {
    if (stopped) return drainPromise ?? Promise.resolve();
    sampleRequested = true;
    drainPromise ??= drainSamples();
    return drainPromise;
  };
  const reportError = async (error: unknown): Promise<void> => {
    try {
      await options.onError?.(error);
    } catch {
      // Diagnostics must never destabilize the observed process.
    }
  };
  async function drainSamples(): Promise<void> {
    while (sampleRequested && !stopped) {
      sampleRequested = false;
      try {
        await writeSample(settings, context);
      } catch (error) {
        await reportError(error);
      }
    }
    drainPromise = null;
  }
  const timer = startTimer(settings.intervalMs, enqueue);
  const stop = async (): Promise<void> => {
    if (!stopped) {
      stopped = true;
      sampleRequested = false;
      if (timer) clearInterval(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
    await drainPromise;
  };
  const onAbort = (): void => void stop();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  void enqueue();
  return {
    enabled: true,
    path: settings.path,
    setPhase: (phase) => {
      context.phase = diagnosticsPhase(phase);
    },
    sample: enqueue,
    flush: () => drainPromise ?? Promise.resolve(),
    stop,
  };
}

function diagnosticsContext(options: SdDiagnosticsOptions): SdDiagnosticsSampleContext {
  return diagnosticsSampleContext(options);
}

function startTimer(intervalMs: number, sample: () => Promise<void>): NodeJS.Timeout | undefined {
  if (intervalMs === 0) return undefined;
  const timer = setInterval(() => void sample(), intervalMs);
  timer.unref?.();
  return timer;
}

function disabledHandle(): SdDiagnosticsHandle {
  return {
    enabled: false,
    path: null,
    setPhase: (_phase: SdDiagnosticsPhase) => {},
    sample: async () => {},
    flush: async () => {},
    stop: async () => {},
  };
}

export {
  DEFAULT_SD_DIAGNOSTICS_DIRECTORY,
  SD_DIAGNOSTICS_FILENAME,
} from './diagnostics-settings.js';
