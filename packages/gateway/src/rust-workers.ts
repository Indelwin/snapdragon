import type { RustGatewayCall } from './rust-call.js';
import {
  fromWireWorkerRecord,
  toWireWorkerHeartbeat,
  toWireWorkerRegistration,
} from './rust-wire-workers.js';
import type {
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';

export async function registerRustWorker(
  call: RustGatewayCall,
  worker: GatewayWorkerRegistration,
): Promise<GatewayWorkerRecord> {
  const record = fromWireWorkerRecord(
    (await call('workers.register', { worker: toWireWorkerRegistration(worker) })) as any,
  );
  if (!record) throw new Error('Gateway returned no worker for workers.register');
  return record;
}

export async function heartbeatRustWorker(
  call: RustGatewayCall,
  heartbeat: GatewayWorkerHeartbeat,
): Promise<GatewayWorkerRecord | undefined> {
  return fromWireWorkerRecord(
    (await call('workers.heartbeat', { heartbeat: toWireWorkerHeartbeat(heartbeat) })) as any,
  );
}

export async function listRustWorkers(call: RustGatewayCall): Promise<GatewayWorkerRecord[]> {
  return ((await call('workers.list')) as unknown[])
    .map((worker) => fromWireWorkerRecord(worker as any))
    .filter((worker): worker is GatewayWorkerRecord => worker !== undefined);
}

export async function showRustWorker(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayWorkerRecord | undefined> {
  return fromWireWorkerRecord((await call('workers.show', { id })) as any);
}
