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
  const result = fromWireWorkerRecord(
    (await call('workers.register', { worker: toWireWorkerRegistration(worker) })) as any,
  );
  if (!result) throw new Error('Gateway returned no worker record');
  return result;
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
  return ((await call('workers.list')) as any[]).map((worker) => {
    const record = fromWireWorkerRecord(worker);
    if (!record) throw new Error('Gateway returned an invalid worker record');
    return record;
  });
}

export async function showRustWorker(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayWorkerRecord | undefined> {
  return fromWireWorkerRecord((await call('workers.show', { id })) as any);
}
