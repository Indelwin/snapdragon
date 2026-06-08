import type {
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayQueueDepth,
} from './types.js';

export function sortLeases(leases: Iterable<GatewayLease>): GatewayLease[] {
  return [...leases].sort((a, b) => a.expiresAtMs - b.expiresAtMs);
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

export function finalJobState(job: GatewayJobStatus, requested: GatewayJobState): GatewayJobState {
  return requested === 'failed' && job.attempts < job.spec.maxAttempts ? 'pending' : requested;
}

export function finishMessage(state: GatewayJobState, error?: string): string {
  if (state === 'pending') return `job failed; retry pending${error ? `: ${error}` : ''}`;
  return error ?? 'job finished';
}

export function logLevel(state: GatewayJobState): string {
  if (state === 'failed') return 'error';
  if (state === 'pending') return 'warn';
  return 'info';
}
