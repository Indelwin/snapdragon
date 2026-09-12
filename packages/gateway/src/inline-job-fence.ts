import type { GatewayJobStatus, GatewayLease, GatewayLeaseFence } from './types.js';

export function assertActiveLease(
  job: GatewayJobStatus,
  lease: GatewayLease | undefined,
  fence: GatewayLeaseFence,
): asserts lease is GatewayLease {
  if (
    job.state !== 'running' ||
    job.leaseId !== fence.leaseId ||
    job.leaseAttempt !== fence.attempt ||
    job.attempts !== fence.attempt ||
    !lease ||
    lease.jobId !== job.id ||
    lease.attempt !== fence.attempt ||
    lease.expiresAtMs <= Date.now()
  ) {
    throw new Error(`stale lease fence for gateway job ${job.id}`);
  }
}
