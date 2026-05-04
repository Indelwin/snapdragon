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
