import type { GatewayLease, GatewayWorkerRecord } from './types.js';

export function assertWorkerAvailable(worker: GatewayWorkerRecord | undefined, id: string): void {
  if (worker?.currentLeaseId) {
    throw new Error(`gateway worker ${id} is busy with active lease ${worker.currentLeaseId}`);
  }
}

export function markWorkerLeased(
  worker: GatewayWorkerRecord,
  queue: string,
  lease: GatewayLease,
): void {
  if (worker.currentLeaseId && worker.currentLeaseId !== lease.id) {
    throw new Error(
      `gateway worker ${worker.id} is busy with active lease ${worker.currentLeaseId}`,
    );
  }
  worker.queue = queue;
  worker.state = 'running';
  worker.currentJobId = lease.jobId;
  worker.currentLeaseId = lease.id;
  worker.leaseExpiresAtMs = lease.expiresAtMs;
  worker.heartbeatAtMs = Date.now();
}

export function renewWorkerLease(
  worker: GatewayWorkerRecord | undefined,
  lease: GatewayLease,
): void {
  if (!worker || worker.currentLeaseId !== lease.id) return;
  worker.leaseExpiresAtMs = lease.expiresAtMs;
  worker.heartbeatAtMs = Date.now();
}

export function clearWorkerLease(
  worker: GatewayWorkerRecord | undefined,
  lease: GatewayLease,
): void {
  if (!worker || worker.currentLeaseId !== lease.id) return;
  worker.state = 'idle';
  worker.currentJobId = undefined;
  worker.currentLeaseId = undefined;
  worker.leaseExpiresAtMs = undefined;
  worker.heartbeatAtMs = Date.now();
}
