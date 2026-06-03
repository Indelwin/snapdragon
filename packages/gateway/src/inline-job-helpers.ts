import type {
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayQueueDepth,
} from './types.js';

export function activeLeasesFromJobs(jobs: Iterable<GatewayJobStatus>): GatewayLease[] {
  return [...jobs].filter(hasActiveLease).map((job) => ({
    id: job.leaseId as string,
    jobId: job.id,
    worker: 'inline',
    acquiredAtMs: job.updatedAtMs,
    expiresAtMs: job.leaseExpiresAtMs as number,
  }));
}

export function queueDepthsFromJobs(jobs: Iterable<GatewayJobStatus>): GatewayQueueDepth[] {
  const queues = new Map<string, GatewayQueueDepth>();
  for (const job of jobs) {
    const depth = queues.get(job.spec.queue) ?? { queue: job.spec.queue, pending: 0, running: 0 };
    if (job.state === 'pending') depth.pending += 1;
    if (job.state === 'running') depth.running += 1;
    queues.set(job.spec.queue, depth);
  }
  return [...queues.values()];
}

export function nextPendingJob(
  jobs: Iterable<GatewayJobStatus>,
  queue: string,
): GatewayJobStatus | undefined {
  return [...jobs]
    .filter((candidate) => candidate.state === 'pending' && candidate.spec.queue === queue)
    .sort((a, b) => b.spec.priority - a.spec.priority || a.createdAtMs - b.createdAtMs)[0];
}

export function retryOrFailedState(job: GatewayJobStatus): GatewayJobState {
  return job.attempts >= job.spec.maxAttempts ? 'failed' : 'pending';
}

export function logLevel(state: GatewayJobState): string {
  return state === 'pending' || state === 'failed' ? 'warn' : 'info';
}

export function finishMessage(state: GatewayJobState, error?: string): string {
  if (state === 'pending') return 'job retry scheduled';
  if (state === 'failed') return error ?? 'job failed';
  return 'job finished';
}

function hasActiveLease(job: GatewayJobStatus): boolean {
  return job.state === 'running' && Boolean(job.leaseId) && Boolean(job.leaseExpiresAtMs);
}

export function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
