import type { GatewayJobLease, GatewayJobStatus } from '@snapdragon-ai/gateway';

export function formatLease(lease: GatewayJobLease): string {
  const expires = new Date(lease.lease.expiresAtMs).toISOString();
  return `acquired ${lease.job.id}\t${lease.job.spec.kind}\tqueue=${lease.job.spec.queue}\tworker=${lease.lease.worker}\tlease=${lease.lease.id}\tattempt=${lease.lease.attempt}\texpires=${expires}\n`;
}

export function formatComplete(id: string, job: GatewayJobStatus | undefined): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return job.state === 'completed'
    ? `completed ${job.id}\n`
    : `job ${job.id} is ${job.state}; complete not applied\n`;
}

export function formatFailure(
  id: string,
  message: string,
  job: GatewayJobStatus | undefined,
): string {
  if (!job) return `Unknown gateway job: ${id}\n`;
  return job.state === 'failed'
    ? `failed ${job.id}\terror=${job.lastError ?? message}\n`
    : `job ${job.id} is ${job.state}; failure not applied\n`;
}
