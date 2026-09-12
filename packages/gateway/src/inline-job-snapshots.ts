import type { GatewayJobStatus, GatewayLease } from './types.js';

export function cloneJob(job: GatewayJobStatus): GatewayJobStatus {
  return {
    ...job,
    spec: {
      ...job.spec,
      payload: cloneValue(job.spec.payload),
    },
    result: cloneValue(job.result),
  };
}

export function cloneLease(lease: GatewayLease): GatewayLease {
  return { ...lease };
}

export function cloneOptional<T>(value: T | undefined, clone: (value: T) => T): T | undefined {
  return value === undefined ? undefined : clone(value);
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
