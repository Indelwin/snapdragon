import type { RustGatewayCall } from './rust-call.js';
import { readAllRustPages } from './rust-pages.js';
import { fromWireJobLease, fromWireJobStatus, toWireJobSpec } from './rust-wire-durable.js';
import type {
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLeaseFence,
} from './types.js';

export async function enqueueRustJob(
  call: RustGatewayCall,
  spec: GatewayJobSpec,
  id?: string,
): Promise<GatewayJobStatus> {
  const job = fromWireJobStatus(
    (await call('jobs.enqueue', { id, spec: toWireJobSpec(spec) })) as any,
  );
  if (!job) throw new Error('Gateway returned no job for jobs.enqueue');
  return job;
}

export async function listRustJobs(call: RustGatewayCall): Promise<GatewayJobStatus[]> {
  return readAllRustPages(call, 'jobs.list', (job) => fromWireJobStatus(job as any));
}

export async function showRustJob(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus((await call('jobs.show', { id })) as any);
}

export async function cancelRustJob(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus((await call('jobs.cancel', { id })) as any);
}

export async function retryRustJob(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus((await call('jobs.retry', { id })) as any);
}

export async function acquireRustJob(
  call: RustGatewayCall,
  queue: string,
  worker: string,
  leaseMs: number,
): Promise<GatewayJobLease | undefined> {
  return fromWireJobLease(
    (await call('jobs.acquire', { queue, worker, lease_ms: leaseMs })) as any,
  );
}

export async function completeRustJob(
  call: RustGatewayCall,
  id: string,
  result: unknown,
  fence: GatewayLeaseFence,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus(
    (await call('jobs.complete', {
      id,
      result,
      lease_id: fence.leaseId,
      attempt: fence.attempt,
    })) as any,
  );
}

export async function failRustJob(
  call: RustGatewayCall,
  id: string,
  error: string,
  fence: GatewayLeaseFence,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus(
    (await call('jobs.fail', {
      id,
      error,
      lease_id: fence.leaseId,
      attempt: fence.attempt,
    })) as any,
  );
}

export async function renewRustJob(
  call: RustGatewayCall,
  id: string,
  fence: GatewayLeaseFence,
  leaseMs: number,
): Promise<GatewayJobLease | undefined> {
  return fromWireJobLease(
    (await call('jobs.renew', {
      id,
      lease_id: fence.leaseId,
      attempt: fence.attempt,
      lease_ms: leaseMs,
    })) as any,
  );
}
