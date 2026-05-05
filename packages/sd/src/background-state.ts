import type {
  SdBackgroundChat,
  SdBackgroundContext,
  SdBackgroundRebindParts,
  SdBackgroundService,
  SdBackgroundServiceStatus,
  SdBackgroundServicesOptions,
} from './background-types.js';
import type { SdConfig } from './config.js';
import type { SdGatewayChannelStore } from './gateway-channels.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';
import type { SdSkillStore } from './skills.js';

/** Mutable bag of shared deps; one instance per gateway, swapped via rebindStores. */
export interface SharedBackgroundParts {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  skills?: SdSkillStore;
  channels?: SdGatewayChannelStore;
  chat?: SdBackgroundChat;
}

export interface ServiceState {
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
export function ctxOf(state: ServiceState): SdBackgroundContext {
  const { shared } = state;
  return {
    config: shared.config,
    memory: shared.memory,
    profile: shared.profile,
    skills: shared.skills,
    channels: shared.channels,
    chat: shared.chat,
    now: state.now,
    log: state.log,
  };
}

/** Build the initial state for one service (context + status + flags). */
export function buildServiceState(
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

/** In-place swap. Omitted keys preserved; explicit `undefined` clears nullable fields. */
export function rebindShared(shared: SharedBackgroundParts, parts: SdBackgroundRebindParts): void {
  for (const key of Object.keys(parts) as Array<keyof SdBackgroundRebindParts>) {
    (shared as unknown as Record<string, unknown>)[key] = parts[key];
  }
}

export function positiveInterval(value: number | undefined): number | undefined {
  return value && Number.isFinite(value) && value > 0 ? value : undefined;
}

export function toSet(input: SdBackgroundServicesOptions['disable']): Set<string> {
  if (!input) return new Set();
  return input instanceof Set ? new Set(input) : new Set(input);
}

export function cloneStatus(status: SdBackgroundServiceStatus): SdBackgroundServiceStatus {
  return { ...status, metrics: { ...status.metrics } };
}
