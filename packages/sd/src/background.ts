/**
 * Generic in-process background services gateway for `sd`.
 *
 * Services implement `SdBackgroundService` (one `runOnce` unit of work plus
 * optional enabled/interval/startupDelay hooks). The gateway owns scheduling,
 * error containment, status tracking, and lifetime. New services just append
 * themselves to the registry — no per-service timer plumbing in `runtime.ts`.
 *
 * Intentionally much smaller than e.g. hermes' cron — no persisted job queue,
 * no user-prompt execution, no cross-process locks. We need:
 *   - one ticking timer per service,
 *   - "fire and forget but never crash the host",
 *   - a status surface for the TUI / commands,
 *   - a `flush()` for tests and clean shutdown.
 */

import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';

/** Context handed to a service on every tick. Kept narrow on purpose. */
export interface SdBackgroundContext {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Stable wall-clock for tests; default is `Date.now()`. */
  now: () => number;
  /** Optional logger; default is no-op. */
  log: (line: string) => void;
}

export interface SdBackgroundServiceResult {
  /** Free-form summary the gateway will surface in `status()`. */
  summary?: string;
  /** Service-specific counters; merged into status under `metrics`. */
  metrics?: Record<string, number>;
}

/** A unit of background work. State (watermarks, dedupe sets) lives in the service's own files or closure. */
export interface SdBackgroundService {
  /** Stable identifier (used in CLI flags, status output, log lines). */
  readonly name: string;
  /** Hard "stay disabled" check; the gateway won't even start the timer. */
  enabled?(ctx: SdBackgroundContext): boolean;
  /** Polling interval. Unset/non-finite/<=0 ⇒ run once at startup, never again unless `runNow`. */
  intervalMs?(ctx: SdBackgroundContext): number | undefined;
  /** Initial delay before the first tick (default 0). */
  startupDelayMs?(ctx: SdBackgroundContext): number | undefined;
  /** One pass of work. Must not throw — but the gateway catches anyway. */
  runOnce(ctx: SdBackgroundContext): Promise<SdBackgroundServiceResult | undefined>;
}

export interface SdBackgroundServiceStatus {
  name: string;
  enabled: boolean;
  interval_ms?: number;
  runs: number;
  errors: number;
  last_run_at?: number;
  last_error?: string;
  last_summary?: string;
  metrics: Record<string, number>;
  in_flight: boolean;
}

export interface SdBackgroundServicesHandle {
  stop(): void;
  /** Resolve once any in-flight ticks across all services have settled. */
  flush(): Promise<void>;
  /** Trigger one immediate run of `name`, awaiting its completion. */
  runNow(name: string): Promise<SdBackgroundServiceStatus | undefined>;
  list(): SdBackgroundServiceStatus[];
  status(name: string): SdBackgroundServiceStatus | undefined;
}

export interface SdBackgroundServicesOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Disable every service regardless of per-service config. */
  disableAll?: boolean;
  /** Disable a specific subset by name. */
  disable?: ReadonlySet<string> | string[];
  now?: () => number;
  log?: (line: string) => void;
}

interface ServiceState {
  service: SdBackgroundService;
  ctx: SdBackgroundContext;
  status: SdBackgroundServiceStatus;
  timer?: NodeJS.Timeout;
  inflight: Promise<void>;
  stopped: boolean;
}

/** Build the initial state for one service (context + status + flags). */
function buildServiceState(
  service: SdBackgroundService,
  options: SdBackgroundServicesOptions,
  disableSet: Set<string>,
  log: (line: string) => void,
  now: () => number,
): ServiceState {
  const ctx: SdBackgroundContext = {
    config: options.config,
    memory: options.memory,
    profile: options.profile,
    now,
    log: (line) => log(`[bg:${service.name}] ${line}`),
  };
  const enabledByService = service.enabled?.(ctx) ?? true;
  const externallyDisabled = options.disableAll === true || disableSet.has(service.name);
  const enabled = enabledByService && !externallyDisabled;
  const intervalMs = enabled ? service.intervalMs?.(ctx) : undefined;
  const status: SdBackgroundServiceStatus = {
    name: service.name,
    enabled,
    interval_ms: positiveInterval(intervalMs),
    runs: 0,
    errors: 0,
    metrics: {},
    in_flight: false,
  };
  return { service, ctx, status, inflight: Promise.resolve(), stopped: false };
}

/** Run one tick: invoke `runOnce`, fold result into status, swallow errors. */
async function runTick(state: ServiceState): Promise<void> {
  if (state.stopped) return;
  state.status.in_flight = true;
  const started = state.ctx.now();
  try {
    const result = (await state.service.runOnce(state.ctx)) ?? undefined;
    state.status.runs += 1;
    state.status.last_run_at = started;
    state.status.last_summary = result?.summary;
    if (result?.metrics) {
      for (const [key, value] of Object.entries(result.metrics)) {
        state.status.metrics[key] = (state.status.metrics[key] ?? 0) + value;
      }
    }
  } catch (error) {
    state.status.errors += 1;
    state.status.last_error = error instanceof Error ? error.message : String(error);
    state.ctx.log(`tick failed: ${state.status.last_error}`);
  } finally {
    state.status.in_flight = false;
  }
}

function scheduleTick(state: ServiceState): void {
  state.inflight = runTick(state);
}

/** Wire startup-delay / interval timers for an enabled service. */
function scheduleService(state: ServiceState): void {
  if (!state.status.enabled) return;
  const startupDelay = state.service.startupDelayMs?.(state.ctx);
  if (startupDelay && Number.isFinite(startupDelay) && startupDelay > 0) {
    const initial = setTimeout(() => {
      if (!state.stopped) scheduleTick(state);
    }, startupDelay);
    if (typeof initial.unref === 'function') initial.unref();
  } else {
    // Kick the first tick on the microtask queue — async but observable
    // via `flush()`, since `state.inflight` is set synchronously here.
    scheduleTick(state);
  }
  const intervalMs = state.status.interval_ms;
  if (intervalMs) {
    state.timer = setInterval(() => {
      // Skip tick if previous one is still running — avoids overlap.
      if (state.status.in_flight) return;
      scheduleTick(state);
    }, intervalMs);
    if (typeof state.timer.unref === 'function') state.timer.unref();
  }
}

/** Start a set of background services. First ticks are scheduled, never run synchronously. */
export function startSdBackgroundServices(
  services: SdBackgroundService[],
  options: SdBackgroundServicesOptions,
): SdBackgroundServicesHandle {
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const disableSet = toSet(options.disable);
  const states = new Map<string, ServiceState>();

  for (const service of services) {
    if (states.has(service.name)) {
      throw new Error(`duplicate background service name: ${service.name}`);
    }
    states.set(service.name, buildServiceState(service, options, disableSet, log, now));
  }
  for (const state of states.values()) scheduleService(state);

  return {
    stop: () => stopAll(states),
    flush: () => flushAll(states),
    runNow: (name) => runNow(states, name),
    list: () => Array.from(states.values()).map((s) => cloneStatus(s.status)),
    status: (name) => {
      const state = states.get(name);
      return state ? cloneStatus(state.status) : undefined;
    },
  };
}

function stopAll(states: Map<string, ServiceState>): void {
  for (const state of states.values()) {
    state.stopped = true;
    if (state.timer) clearInterval(state.timer);
    state.timer = undefined;
  }
}

async function flushAll(states: Map<string, ServiceState>): Promise<void> {
  // Two passes: the first awaits whatever is currently in flight; if a
  // timer fires during that await we'll see a fresh `inflight` promise on
  // the second pass. Two passes is enough because `runTick()` doesn't chain
  // follow-up ticks itself — the interval timer schedules them.
  for (let i = 0; i < 2; i += 1) {
    await Promise.allSettled(Array.from(states.values()).map((s) => s.inflight));
  }
}

async function runNow(
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

function positiveInterval(value: number | undefined): number | undefined {
  return value && Number.isFinite(value) && value > 0 ? value : undefined;
}

function toSet(input: SdBackgroundServicesOptions['disable']): Set<string> {
  if (!input) return new Set();
  return input instanceof Set ? new Set(input) : new Set(input);
}

function cloneStatus(status: SdBackgroundServiceStatus): SdBackgroundServiceStatus {
  return { ...status, metrics: { ...status.metrics } };
}
