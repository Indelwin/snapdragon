import type { RustGatewayCall } from './rust-call.js';
import { fromWireJobLease, fromWireJobStatus, toWireJobSpec } from './rust-wire-durable.js';
import type { GatewayJobLease, GatewayJobSpec, GatewayJobStatus } from './types.js';

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
  return ((await call('jobs.list')) as unknown[])
    .map((job) => fromWireJobStatus(job as any))
    .filter((job): job is GatewayJobStatus => job !== undefined);
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
  result?: unknown,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus((await call('jobs.complete', { id, result })) as any);
}

export async function failRustJob(
  call: RustGatewayCall,
  id: string,
  error: string,
): Promise<GatewayJobStatus | undefined> {
  return fromWireJobStatus((await call('jobs.fail', { id, error })) as any);
}
