import { expireInlineJob } from './inline-job-expiry.js';
import {
  finalJobState,
  finishMessage,
  logLevel,
  nextPendingJob,
  queueDepthsFromJobs,
} from './inline-job-helpers.js';
import { InlineJobLeases } from './inline-job-leases.js';
import { cloneJob, cloneLease, cloneOptional } from './inline-job-snapshots.js';
import type {
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayLeaseFence,
} from './types.js';

interface InlineLogger {
  log(level: string, target: string | undefined, message: string, data?: unknown): void;
  onLeaseExpired?(lease: GatewayLease): void;
}

export class InlineJobStore {
  #jobs = new Map<string, GatewayJobStatus>();
  #leases = new InlineJobLeases((lease) =>
    expireInlineJob(this.#jobs.get(lease.jobId), lease, this.logger),
  );

  constructor(private readonly logger: InlineLogger) {}

  enqueue(spec: GatewayJobSpec, id = inlineId('job')): GatewayJobStatus {
    if (this.#jobs.has(id)) throw new Error(`gateway job id already exists: ${id}`);
    const now = Date.now();
    const status: GatewayJobStatus = {
      id,
      spec: {
        kind: spec.kind,
        queue: spec.queue ?? 'default',
        payload: spec.payload ?? {},
        priority: spec.priority ?? 0,
        maxAttempts: spec.maxAttempts ?? 1,
        timeoutMs: spec.timeoutMs,
      },
      state: 'pending',
      attempts: 0,
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.#jobs.set(id, status);
    this.logger.log('info', id, 'job enqueued', { kind: status.spec.kind });
    return cloneJob(status);
  }

  list(): GatewayJobStatus[] {
    return [...this.#jobs.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs).map(cloneJob);
  }

  show(id: string): GatewayJobStatus | undefined {
    return cloneOptional(this.#jobs.get(id), cloneJob);
  }

  cancel(id: string): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    this.#clearLease(job);
    job.state = 'cancelled';
    job.updatedAtMs = Date.now();
    job.leaseId = undefined;
    job.leaseAttempt = undefined;
    job.leaseExpiresAtMs = undefined;
    this.logger.log('warn', id, 'job cancelled');
    return cloneJob(job);
  }

  acquire(queue: string, worker: string, leaseMs = 300_000): GatewayJobLease | undefined {
    const job = this.#nextPendingJob(queue);
    if (!job) return undefined;
    const now = Date.now();
    const lease = {
      id: `lease_${job.id}_${job.attempts + 1}_${now}`,
      jobId: job.id,
      worker,
      attempt: job.attempts + 1,
      acquiredAtMs: now,
      expiresAtMs: now + leaseMs,
    };
    Object.assign(job, {
      state: 'running',
      attempts: job.attempts + 1,
      updatedAtMs: now,
      leaseId: lease.id,
      leaseAttempt: lease.attempt,
      leaseExpiresAtMs: lease.expiresAtMs,
    });
    this.#leases.add(lease);
    this.logger.log('info', job.id, 'job leased');
    return { job: cloneJob(job), lease: cloneLease(lease) };
  }

  renew(id: string, fence: GatewayLeaseFence, leaseMs = 300_000): GatewayJobLease | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    const lease = this.#leases.renew(job, fence, leaseMs);
    job.updatedAtMs = Date.now();
    job.leaseExpiresAtMs = lease.expiresAtMs;
    return { job: cloneJob(job), lease: cloneLease(lease) };
  }

  complete(id: string, result: unknown, fence: GatewayLeaseFence): GatewayJobStatus | undefined {
    return this.#finish(id, fence, 'completed', result);
  }

  fail(id: string, error: string, fence: GatewayLeaseFence): GatewayJobStatus | undefined {
    return this.#finish(id, fence, 'failed', undefined, error);
  }

  retry(id: string): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state !== 'failed') return cloneJob(job);
    this.#clearLease(job);
    Object.assign(job, {
      state: 'pending',
      result: undefined,
      updatedAtMs: Date.now(),
      leaseId: undefined,
      leaseAttempt: undefined,
      leaseExpiresAtMs: undefined,
    });
    this.logger.log('info', id, 'job retry requested');
    return cloneJob(job);
  }

  count(state: GatewayJobState): number {
    return [...this.#jobs.values()].filter((job) => job.state === state).length;
  }

  activeLeases(): GatewayLease[] {
    return this.#leases.active();
  }

  queueDepths() {
    return queueDepthsFromJobs(this.#jobs.values());
  }

  close(): void {
    this.#leases.close();
  }

  #nextPendingJob(queue: string): GatewayJobStatus | undefined {
    return nextPendingJob(this.#jobs.values(), queue);
  }

  #finish(
    id: string,
    fence: GatewayLeaseFence,
    state: GatewayJobState,
    result?: unknown,
    error?: string,
  ): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    this.#leases.assert(job, fence);
    const finalState = finalJobState(job, state);
    this.#clearLease(job);
    Object.assign(job, {
      state: finalState,
      result,
      lastError: error,
      updatedAtMs: Date.now(),
      leaseId: undefined,
      leaseAttempt: undefined,
      leaseExpiresAtMs: undefined,
    });
    this.logger.log(logLevel(finalState), id, finishMessage(finalState, error));
    return cloneJob(job);
  }

  #clearLease(job: GatewayJobStatus): GatewayLease | undefined {
    return this.#leases.clear(job);
  }
}

function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
