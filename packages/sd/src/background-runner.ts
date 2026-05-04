import { flushAll, runNow, scheduleService, stopAll } from './background-scheduler.js';
import {
  buildServiceState,
  cloneStatus,
  rebindShared,
  type ServiceState,
  type SharedBackgroundParts,
  toSet,
} from './background-state.js';
import type {
  SdBackgroundService,
  SdBackgroundServicesHandle,
  SdBackgroundServicesOptions,
} from './background-types.js';

/** Start a set of background services. First ticks are scheduled, never run synchronously. */
export function startSdBackgroundServices(
  services: SdBackgroundService[],
  options: SdBackgroundServicesOptions,
): SdBackgroundServicesHandle {
  const log = options.log ?? (() => {});
  const now = options.now ?? Date.now;
  const disableSet = toSet(options.disable);
  const shared = sharedParts(options);
  const states = serviceStates(services, shared, options, disableSet, log, now);
  for (const state of states.values()) scheduleService(state);
  return backgroundHandle(states, shared);
}

function sharedParts(options: SdBackgroundServicesOptions): SharedBackgroundParts {
  return {
    config: options.config,
    memory: options.memory,
    profile: options.profile,
    skills: options.skills,
    chat: options.chat,
  };
}

function serviceStates(
  services: SdBackgroundService[],
  shared: SharedBackgroundParts,
  options: SdBackgroundServicesOptions,
  disableSet: Set<string>,
  log: (line: string) => void,
  now: () => number,
): Map<string, ServiceState> {
  const states = new Map<string, ServiceState>();
  for (const service of services) {
    if (states.has(service.name)) {
      throw new Error(`duplicate background service name: ${service.name}`);
    }
    states.set(service.name, buildServiceState(service, shared, options, disableSet, log, now));
  }
  return states;
}

function backgroundHandle(
  states: Map<string, ServiceState>,
  shared: SharedBackgroundParts,
): SdBackgroundServicesHandle {
  return {
    stop: () => stopAll(states),
    flush: () => flushAll(states),
    runNow: (name) => runNow(states, name),
    list: () => Array.from(states.values()).map((s) => cloneStatus(s.status)),
    status: (name) => status(states, name),
    rebindStores: (parts) => rebindShared(shared, parts),
  };
}

function status(
  states: Map<string, ServiceState>,
  name: string,
): ReturnType<SdBackgroundServicesHandle['status']> {
  const state = states.get(name);
  return state ? cloneStatus(state.status) : undefined;
}
