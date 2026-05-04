import { cloneStatus, ctxOf, positiveInterval, type ServiceState } from './background-state.js';
import { scheduleTick } from './background-tick.js';
import type { SdBackgroundServiceStatus } from './background-types.js';

/** Wire startup-delay / interval timers for an enabled service. */
export function scheduleService(state: ServiceState): void {
  if (!state.status.enabled) return;
  scheduleStartup(state, state.service.startupDelayMs?.(ctxOf(state)));
  scheduleInterval(state);
}

function scheduleStartup(state: ServiceState, startupDelay: number | undefined): void {
  const delay = positiveInterval(startupDelay);
  if (delay) {
    const initial = setTimeout(() => {
      if (!state.stopped) scheduleTick(state);
    }, delay);
    if (typeof initial.unref === 'function') initial.unref();
    return;
  }
  // Kick the first tick on the microtask queue — async but observable
  // via `flush()`, since `state.inflight` is set synchronously here.
  scheduleTick(state);
}

function scheduleInterval(state: ServiceState): void {
  const intervalMs = state.status.interval_ms;
  if (!intervalMs) return;
  state.timer = setInterval(() => {
    // Skip tick if previous one is still running — avoids overlap.
    if (state.status.in_flight) return;
    scheduleTick(state);
  }, intervalMs);
  if (typeof state.timer.unref === 'function') state.timer.unref();
}

export function stopAll(states: Map<string, ServiceState>): void {
  for (const state of states.values()) stopOne(state);
}

function stopOne(state: ServiceState): void {
  state.stopped = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
}

export async function flushAll(states: Map<string, ServiceState>): Promise<void> {
  // Two passes: the first awaits whatever is currently in flight; if a
  // timer fires during that await we'll see a fresh `inflight` promise on
  // the second pass. Two passes is enough because `runTick()` doesn't chain
  // follow-up ticks itself — the interval timer schedules them.
  for (let i = 0; i < 2; i += 1) await flushPass(states);
}

function flushPass(states: Map<string, ServiceState>): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(Array.from(states.values()).map((s) => s.inflight));
}

export async function runNow(
  states: Map<string, ServiceState>,
  name: string,
): Promise<SdBackgroundServiceStatus | undefined> {
  const state = states.get(name);
  if (!state) return undefined;
  if (!state.status.enabled) return cloneStatus(state.status);
  // Wait for any in-flight tick first to keep ordering well-defined.
  await state.inflight;
  scheduleTick(state);
  await state.inflight;
  return cloneStatus(state.status);
}
