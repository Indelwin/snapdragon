import type { RustGatewayCall } from './rust-call.js';
import { fromWireEventRecord, fromWireLogRecord, toWireLogInput } from './rust-wire-durable.js';
import type { GatewayEventRecord, GatewayLogInput, GatewayLogRecord } from './types.js';

export async function appendRustEvent(
  call: RustGatewayCall,
  input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  },
): Promise<GatewayEventRecord> {
  const event = fromWireEventRecord((await call('events.append', input)) as any);
  if (!event) throw new Error('Gateway returned no event for events.append');
  return event;
}

export async function listRustEvents(call: RustGatewayCall): Promise<GatewayEventRecord[]> {
  return ((await call('events.list')) as unknown[])
    .map((event) => fromWireEventRecord(event as any))
    .filter((event): event is GatewayEventRecord => event !== undefined);
}

export async function cancelRustEvent(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayEventRecord | undefined> {
  return fromWireEventRecord((await call('events.cancel', { id })) as any);
}

export async function appendRustLog(
  call: RustGatewayCall,
  input: GatewayLogInput,
): Promise<GatewayLogRecord> {
  return fromWireLogRecord(await call('logs.append', toWireLogInput(input)));
}

export async function tailRustLogs(
  call: RustGatewayCall,
  options: { target?: string; limit?: number },
): Promise<GatewayLogRecord[]> {
  return ((await call('logs.tail', options)) as any[]).map(fromWireLogRecord);
}
