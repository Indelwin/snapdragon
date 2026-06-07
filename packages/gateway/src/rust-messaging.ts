import type { RustGatewayCall } from './rust-call.js';
import {
  fromWireActor,
  fromWireEnvelope,
  fromWireRegistrySnapshot,
  toWireActor,
  toWireEnvelope,
  toWireFilter,
} from './rust-wire.js';
import type {
  ActorId,
  GatewayEnvelope,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
} from './types.js';

export async function sendRustEnvelope(
  call: RustGatewayCall,
  envelope: GatewayEnvelope,
): Promise<void> {
  await call('envelope.send', { envelope: toWireEnvelope(envelope) });
}

export async function receiveRustEnvelope(
  call: RustGatewayCall,
  actor: ActorId,
  filter: GatewayReceiveFilter,
): Promise<GatewayEnvelope | undefined> {
  return fromWireEnvelope(
    await call('envelope.receive', {
      actor: toWireActor(actor),
      filter: toWireFilter(filter),
    }),
  );
}

export async function registerRustCapability(
  call: RustGatewayCall,
  capability: string,
  actor: ActorId,
): Promise<void> {
  await call('registry.register_capability', { capability, actor: toWireActor(actor) });
}

export async function whereisRustCapability(
  call: RustGatewayCall,
  capability: string,
): Promise<ActorId[]> {
  const actors = (await call('registry.whereis_capability', { capability })) as unknown[];
  return actors.map(fromWireActor);
}

export async function rustRegistrySnapshot(
  call: RustGatewayCall,
): Promise<GatewayRegistrySnapshot> {
  return fromWireRegistrySnapshot(await call('registry.list'));
}
