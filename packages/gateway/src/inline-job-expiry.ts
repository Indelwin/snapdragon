import type { GatewayJobStatus, GatewayLease } from './types.js';

interface ExpiryLogger {
  log(level: string, target: string | undefined, message: string, data?: unknown): void;
  onLeaseExpired?(lease: GatewayLease): void;
}

export function expireInlineJob(
  job: GatewayJobStatus | undefined,
  lease: GatewayLease,
  logger: ExpiryLogger,
): void {
  if (!job || job.leaseId !== lease.id || job.leaseAttempt !== lease.attempt) return;
  job.state = job.attempts >= job.spec.maxAttempts ? 'failed' : 'pending';
  job.updatedAtMs = Date.now();
  job.lastError = 'lease expired';
  job.leaseId = undefined;
  job.leaseAttempt = undefined;
  job.leaseExpiresAtMs = undefined;
  logger.onLeaseExpired?.(lease);
  logger.log('warn', job.id, 'job lease expired');
}
