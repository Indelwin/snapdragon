import type {
  SdBackgroundRebindParts,
  SdBackgroundServiceStatus,
  SdBackgroundServicesHandle,
} from './background-types.js';

export function emptyBackgroundHandle(): SdBackgroundServicesHandle {
  return {
    stop() {},
    async flush() {},
    async runNow() {
      return undefined;
    },
    list() {
      return [];
    },
    status() {
      return undefined;
    },
    rebindStores(_parts: SdBackgroundRebindParts) {},
  };
}

export function statusByName(
  statuses: readonly SdBackgroundServiceStatus[],
  name: string,
): SdBackgroundServiceStatus | undefined {
  return statuses.find((status) => status.name === name);
}
