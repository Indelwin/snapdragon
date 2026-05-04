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

import type { Message } from '@snapdragon-ai/host';
import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import type { SdSkillStore } from './skills.js';

/**
 * One-shot completion call available to background services that need an LLM
 * (e.g. skill-builder drafting a SKILL.md from a recurring tool sequence).
 * Deliberately narrower than the full StreamingChatHandler — services just
 * need a string back. Implementations should be cheap-by-default and
 * low-priority; a missing implementation must be tolerated.
 */
export type SdBackgroundChat = (
  messages: Message[],
  options?: { max_tokens?: number; signal?: AbortSignal },
) => Promise<{ content: string }>;

/** Context handed to a service on every tick. Kept narrow on purpose. */
export interface SdBackgroundContext {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Active skill catalog; lets services consult what already exists. */
  skills?: SdSkillStore;
  /** Optional one-shot LLM completion; absent on runtimes without a provider. */
  chat?: SdBackgroundChat;
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
  /**
   * Hot-swap shared deps (config / stores / chat / profile) seen by every
   * running service WITHOUT tearing down timers or losing watermark state.
   * The next `runOnce(ctx)` call sees the new values; an in-flight tick
   * keeps the values it captured. Omitted keys preserved; explicit
   * `undefined` clears nullable fields. `interval_ms` and the service
   * registry are NOT rebindable — restart for those.
   */
  rebindStores(parts: SdBackgroundRebindParts): void;
}

/** Subset of `SdBackgroundServicesOptions` swappable via `rebindStores`. */
export interface SdBackgroundRebindParts {
  config?: SdConfig;
  memory?: SdMemoryProvider;
  profile?: SdProfileInfo;
  skills?: SdSkillStore;
  chat?: SdBackgroundChat;
}

export interface SdBackgroundServicesOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Active skill catalog; lets services see existing skills. */
  skills?: SdSkillStore;
  /** Optional LLM completion handle, plumbed into each service's context. */
  chat?: SdBackgroundChat;
  /** Disable every service regardless of per-service config. */
  disableAll?: boolean;
  /** Disable a specific subset by name. */
  disable?: ReadonlySet<string> | string[];
  now?: () => number;
  log?: (line: string) => void;
}

/** Mutable bag of shared deps; one instance per gateway, swapped via rebindStores. */
interface SharedBackgroundParts {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  skills?: SdSkillStore;
  chat?: SdBackgroundChat;
}

interface ServiceState {
  service: SdBackgroundService;
  shared: SharedBackgroundParts;
  log: (line: string) => void;
  now: () => number;
  status: SdBackgroundServiceStatus;
  timer?: NodeJS.Timeout;
  inflight: Promise<void>;
  stopped: boolean;
}

/** Build a fresh `SdBackgroundContext` view over the shared bag. */
function ctxOf(state: ServiceState): SdBackgroundContext {
  const { shared } = state;
  return {
    config: shared.config,
    memory: shared.memory,
    profile: shared.profile,
    skills: shared.skills,
    chat: shared.chat,
    now: state.now,
    log: state.log,
  };
}

/** Build the initial state for one service (context + status + flags). */
function buildServiceState(
  service: SdBackgroundService,
  shared: SharedBackgroundParts,
  options: SdBackgroundServicesOptions,
  disableSet: Set<string>,
  log: (line: string) => void,
  now: () => number,
): ServiceState {
  const state: ServiceState = {
    service,
    shared,
    log: (line) => log(`[bg:${service.name}] ${line}`),
    now,
    status: {
      name: service.name,
      enabled: false,
      runs: 0,
      errors: 0,
      metrics: {},
      in_flight: false,
    },
    inflight: Promise.resolve(),
    stopped: false,
  };
  const ctx = ctxOf(state);
  const enabledByService = service.enabled?.(ctx) ?? true;
  const externallyDisabled = options.disableAll === true || disableSet.has(service.name);
  const enabled = enabledByService && !externallyDisabled;
  const intervalMs = enabled ? service.intervalMs?.(ctx) : undefined;
  state.status.enabled = enabled;
  state.status.interval_ms = positiveInterval(intervalMs);
  return state;
}

/** Run one tick: invoke `runOnce`, fold result into status, swallow errors. */
async function runTick(state: ServiceState): Promise<void> {
  if (state.stopped) return;
  state.status.in_flight = true;
  const started = state.now();
  try {
    const result = (await state.service.runOnce(ctxOf(state))) ?? undefined;
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
    state.log(`tick failed: ${state.status.last_error}`);
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
  const startupDelay = state.service.startupDelayMs?.(ctxOf(state));
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
  const shared: SharedBackgroundParts = {
    config: options.config,
    memory: options.memory,
    profile: options.profile,
    skills: options.skills,
    chat: options.chat,
  };

  for (const service of services) {
    if (states.has(service.name)) {
      throw new Error(`duplicate background service name: ${service.name}`);
    }
    states.set(service.name, buildServiceState(service, shared, options, disableSet, log, now));
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
    rebindStores: (parts) => rebindShared(shared, parts),
  };
}

/** In-place swap. Omitted keys preserved; explicit `undefined` clears nullable fields. */
function rebindShared(shared: SharedBackgroundParts, parts: SdBackgroundRebindParts): void {
  for (const key of Object.keys(parts) as Array<keyof SdBackgroundRebindParts>) {
    (shared as unknown as Record<string, unknown>)[key] = parts[key];
  }
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
