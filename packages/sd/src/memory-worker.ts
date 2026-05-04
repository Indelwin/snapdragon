import type {
  SdBackgroundContext,
  SdBackgroundService,
  SdBackgroundServiceResult,
} from './background.js';
import { memoryWorkerDisabled } from './memory-worker-context.js';
import { runMemoryWorkerScan } from './memory-worker-scan.js';
import type { SdMemoryWorkerOptions, SdMemoryWorkerScanResult } from './memory-worker-types.js';

export type { SdMemoryWorkerOptions, SdMemoryWorkerScanResult } from './memory-worker-types.js';

/**
 * Run a single pass of the background worker. Pure with respect to wall-clock
 * (apart from `Date.now`), idempotent across calls thanks to the watermark.
 */
export async function runSdMemoryWorkerOnce(
  options: SdMemoryWorkerOptions,
): Promise<SdMemoryWorkerScanResult> {
  const result = emptyMemoryWorkerResult();
  if (memoryWorkerDisabled(options.config)) return result;
  await runMemoryWorkerScan(options, result);
  return result;
}

function emptyMemoryWorkerResult(): SdMemoryWorkerScanResult {
  return {
    scanned_sessions: 0,
    considered_messages: 0,
    captured: 0,
    skipped_duplicates: 0,
    errors: [],
  };
}

export interface SdMemoryWorkerHandle {
  stop(): void;
  /** Resolves once any in-flight scan finishes. */
  flush(): Promise<void>;
}

/**
 * Start a background timer that runs the worker on an interval. Returns a
 * handle that lets the caller stop the worker on shutdown. The first scan is
 * scheduled (not run synchronously) so callers can rely on this not blocking.
 */
export function startSdMemoryWorker(
  options: SdMemoryWorkerOptions,
): SdMemoryWorkerHandle | undefined {
  const cfg = options.config.memory?.worker;
  if (!cfg?.enabled) return undefined;
  const interval = cfg.interval_ms ?? 5 * 60 * 1000;
  if (!Number.isFinite(interval) || interval <= 0) return undefined;

  let stopped = false;
  let inflight: Promise<void> = Promise.resolve();

  const tick = async () => {
    if (stopped) return;
    inflight = runSdMemoryWorkerOnce(options)
      .then(() => undefined)
      .catch((error) => {
        options.log?.(
          `[memory-worker] scan failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    await inflight;
  };

  const timer = setInterval(() => {
    void tick();
  }, interval);
  // Don't keep the Node event loop alive just for the worker.
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    async flush() {
      await inflight;
    },
  };
}

/**
 * Wrap the memory worker as an `SdBackgroundService` so it slots into the
 * generic background gateway. The service's enabled/interval values are read
 * lazily from the runtime config — same source of truth as the legacy
 * `startSdMemoryWorker`. Errors are surfaced via the gateway's status surface
 * rather than thrown.
 */
export function memoryWorkerService(): SdBackgroundService {
  return {
    name: 'memory-worker',
    enabled(ctx: SdBackgroundContext) {
      const cfg = ctx.config.memory;
      if (cfg?.enabled === false) return false;
      if (cfg?.authoring === false) return false;
      return cfg?.worker?.enabled === true;
    },
    intervalMs(ctx: SdBackgroundContext) {
      return ctx.config.memory?.worker?.interval_ms ?? 5 * 60 * 1000;
    },
    async runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult> {
      const result = await runSdMemoryWorkerOnce({
        config: ctx.config,
        memory: ctx.memory,
        profile: ctx.profile,
        log: ctx.log,
      });
      return {
        summary:
          result.captured > 0
            ? `captured ${result.captured} from ${result.scanned_sessions} session(s)`
            : `scanned ${result.scanned_sessions}, no new captures`,
        metrics: {
          scanned_sessions: result.scanned_sessions,
          considered_messages: result.considered_messages,
          captured: result.captured,
          skipped_duplicates: result.skipped_duplicates,
          errors: result.errors.length,
        },
      };
    },
  };
}
