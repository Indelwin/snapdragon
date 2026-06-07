import type { RustGatewayCall } from './rust-call.js';
import { fromWireTableSnapshot, toWireActor, toWireTableAccess } from './rust-wire.js';
import type { ActorId, GatewayTableAccess, GatewayTableSnapshot } from './types.js';

export async function createRustTable(
  call: RustGatewayCall,
  name: string,
  owner: ActorId,
  access: GatewayTableAccess,
): Promise<boolean> {
  return Boolean(
    await call('tables.create', {
      name,
      owner: toWireActor(owner),
      access: toWireTableAccess(access),
    }),
  );
}

export async function listRustTables(call: RustGatewayCall): Promise<string[]> {
  return ((await call('tables.list')) as string[]).sort();
}

export async function showRustTable(
  call: RustGatewayCall,
  name: string,
): Promise<GatewayTableSnapshot | undefined> {
  return fromWireTableSnapshot((await call('tables.show', { name })) as any);
}
