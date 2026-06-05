import type { GatewayJobLease, GatewayJobStatus } from '@snapdragon-ai/gateway';

export function formatAcquiredLease(lease: GatewayJobLease): string {
  const expires = new Date(lease.lease.expiresAtMs).toISOString();
  return `acquired ${lease.job.id}\t${lease.job.spec.kind}\tqueue=${lease.job.spec.queue}\tworker=${lease.lease.worker}\tlease=${lease.lease.id}\texpires=${expires}\n`;
}

export function formatCompleteResult(id: string, job: GatewayJobStatus | undefined): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return job.state === 'completed'
    ? `completed ${job.id}\n`
    : `job ${job.id} is ${job.state}; complete not applied\n`;
}

export function formatFailureResult(
  id: string,
  message: string,
  job: GatewayJobStatus | undefined,
): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return ['pending', 'failed'].includes(job.state)
    ? `failure recorded ${job.id}\tstate=${job.state}\terror=${job.lastError ?? message}\n`
    : `job ${job.id} is ${job.state}; failure not applied\n`;
}
