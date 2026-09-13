import type { GatewayJobStatus, GatewayLease, GatewayLeaseFence } from '@snapdragon-ai/gateway';

export function leaseFenceForJob(job: GatewayJobStatus): GatewayLeaseFence {
  if (!job.leaseId || !job.leaseAttempt) {
    throw new Error(`gateway job ${job.id} has no active lease fence`);
  }
  return { leaseId: job.leaseId, attempt: job.leaseAttempt };
}

export function leaseFence(lease: GatewayLease): GatewayLeaseFence {
  return { leaseId: lease.id, attempt: lease.attempt };
}
