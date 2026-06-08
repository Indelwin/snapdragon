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
  #leases = new Map<string, GatewayLease>();

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
    this.#clearLease(job);
    job.state = 'cancelled';
    job.updatedAtMs = Date.now();
    job.leaseId = undefined;
    job.leaseExpiresAtMs = undefined;
    this.logger.log('warn', id, 'job cancelled');
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
    this.#leases.set(lease.id, lease);
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
    return [...this.#leases.values()].sort((a, b) => a.expiresAtMs - b.expiresAtMs);
  }

  queueDepths(): GatewayQueueDepth[] {
    const queues = new Map<string, GatewayQueueDepth>();
    for (const job of this.#jobs.values()) {
      const depth = queues.get(job.spec.queue) ?? { queue: job.spec.queue, pending: 0, running: 0 };
      if (job.state === 'pending') depth.pending += 1;
      if (job.state === 'running') depth.running += 1;
      queues.set(job.spec.queue, depth);
    }
    return [...queues.values()];
  }

  #nextPendingJob(queue: string): GatewayJobStatus | undefined {
    return [...this.#jobs.values()]
      .filter((candidate) => candidate.state === 'pending' && candidate.spec.queue === queue)
      .sort((a, b) => b.spec.priority - a.spec.priority || a.createdAtMs - b.createdAtMs)[0];
  }

  #finish(
    id: string,
    state: GatewayJobState,
    result?: unknown,
    error?: string,
  ): GatewayJobStatus | undefined {
    const job = this.#jobs.get(id);
    if (!job) return undefined;
    if (job.state === 'cancelled') return job;
    this.#clearLease(job);
    Object.assign(job, {
      state,
      result,
      lastError: error,
      updatedAtMs: Date.now(),
      leaseId: undefined,
      leaseExpiresAtMs: undefined,
    });
    this.logger.log(error ? 'error' : 'info', id, error ?? 'job finished');
    return job;
  }

  #clearLease(job: GatewayJobStatus): GatewayLease | undefined {
    const lease = job.leaseId ? this.#leases.get(job.leaseId) : undefined;
    if (job.leaseId) this.#leases.delete(job.leaseId);
    return lease;
  }
}

function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
