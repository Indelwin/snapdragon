import {
  activeLeasesFromJobs,
  finishMessage,
  inlineId,
  logLevel,
  nextPendingJob,
  queueDepthsFromJobs,
  retryOrFailedState,
} from './inline-job-helpers.js';
import type {
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayQueueDepth,
} from './types.js';

interface InlineLogger {
  log(level: string, target: string | undefined, message: string, data?: unknown): void;
}

export class InlineJobStore {
  #jobs = new Map<string, GatewayJobStatus>();

  constructor(private readonly logger: InlineLogger) {}

  enqueue(spec: GatewayJobSpec, id = inlineId('job')): GatewayJobStatus {
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
    return status;
  }

  list(): GatewayJobStatus[] {
    return [...this.#jobs.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  show(id: string): GatewayJobStatus | undefined {
    return this.#jobs.get(id);
  }

  cancel(id: string): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    job.state = 'cancelled';
    job.updatedAtMs = Date.now();
    job.leaseId = undefined;
    job.leaseExpiresAtMs = undefined;
    this.logger.log('warn', id, 'job cancelled');
    return job;
  }

  retry(id: string): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state !== 'failed') return job;
    Object.assign(job, {
      state: 'pending',
      result: undefined,
      updatedAtMs: Date.now(),
      leaseId: undefined,
      leaseExpiresAtMs: undefined,
    });
    this.logger.log('info', id, 'job retry requested');
    return job;
  }

  acquire(queue: string, worker: string, leaseMs = 300_000): GatewayJobLease | undefined {
    const job = this.#nextPendingJob(queue);
    if (!job) return undefined;
    const now = Date.now();
    const lease = {
      id: `lease_${job.id}`,
      jobId: job.id,
      worker,
      acquiredAtMs: now,
      expiresAtMs: now + leaseMs,
    };
    Object.assign(job, {
      state: 'running',
      attempts: job.attempts + 1,
      updatedAtMs: now,
      leaseId: lease.id,
      leaseExpiresAtMs: lease.expiresAtMs,
    });
    this.logger.log('info', job.id, 'job leased');
    return { job, lease };
  }

  complete(id: string, result?: unknown): GatewayJobStatus | undefined {
    return this.#finish(id, 'completed', result);
  }

  fail(id: string, error: string): GatewayJobStatus | undefined {
    return this.#finish(id, 'failed', undefined, error);
  }

  count(state: GatewayJobState): number {
    return [...this.#jobs.values()].filter((job) => job.state === state).length;
  }

  activeLeases(): GatewayLease[] {
    return activeLeasesFromJobs(this.#jobs.values());
  }

  queueDepths(): GatewayQueueDepth[] {
    return queueDepthsFromJobs(this.#jobs.values());
  }

  #nextPendingJob(queue: string): GatewayJobStatus | undefined {
    return nextPendingJob(this.#jobs.values(), queue);
  }

  #finish(
    id: string,
    state: GatewayJobStatus['state'],
    result?: unknown,
    error?: string,
  ): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state === 'cancelled') return job;
    const finalState = state === 'failed' ? retryOrFailedState(job) : state;
    Object.assign(job, {
      state: finalState,
      result,
      lastError: error,
      updatedAtMs: Date.now(),
      leaseId: undefined,
      leaseExpiresAtMs: undefined,
    });
    this.logger.log(logLevel(finalState), id, finishMessage(finalState, error));
    return job;
  }
}
