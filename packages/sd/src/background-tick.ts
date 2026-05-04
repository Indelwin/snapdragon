import { ctxOf, type ServiceState } from './background-state.js';
import type { SdBackgroundServiceResult } from './background-types.js';

/** Run one tick: invoke `runOnce`, fold result into status, swallow errors. */
export async function runTick(state: ServiceState): Promise<void> {
  if (state.stopped) return;
  state.status.in_flight = true;
  const started = state.now();
  try {
    applyResult(state, (await state.service.runOnce(ctxOf(state))) ?? undefined, started);
  } catch (error) {
    recordError(state, error);
  } finally {
    state.status.in_flight = false;
  }
}

function applyResult(
  state: ServiceState,
  result: SdBackgroundServiceResult | undefined,
  started: number,
): void {
  state.status.runs += 1;
  state.status.last_run_at = started;
  state.status.last_summary = result?.summary;
  if (result?.metrics) mergeMetrics(state, result.metrics);
}

function mergeMetrics(state: ServiceState, metrics: Record<string, number>): void {
  for (const [key, value] of Object.entries(metrics)) {
    state.status.metrics[key] = (state.status.metrics[key] ?? 0) + value;
  }
}

function recordError(state: ServiceState, error: unknown): void {
  state.status.errors += 1;
  state.status.last_error = error instanceof Error ? error.message : String(error);
  state.log(`tick failed: ${state.status.last_error}`);
}

export function scheduleTick(state: ServiceState): void {
  state.inflight = runTick(state);
}
