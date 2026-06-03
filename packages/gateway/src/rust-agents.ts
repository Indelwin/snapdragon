import type { RustGatewayCall } from './rust-call.js';
import {
  fromWireAgentRuntimeDescriptor,
  toWireAgentRuntimeDescriptor,
} from './rust-wire-runtime.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';

export async function registerRustAgentRuntime(
  call: RustGatewayCall,
  descriptor: GatewayAgentRuntimeDescriptor,
): Promise<GatewayAgentRuntimeDescriptor> {
  const runtime = fromWireAgentRuntimeDescriptor(
    (await call('agents.register', {
      descriptor: toWireAgentRuntimeDescriptor(descriptor),
    })) as any,
  );
  if (!runtime) throw new Error('Gateway returned no runtime for agents.register');
  return runtime;
}

export async function listRustAgentRuntimes(
  call: RustGatewayCall,
): Promise<GatewayAgentRuntimeDescriptor[]> {
  return ((await call('agents.list')) as unknown[])
    .map((runtime) => fromWireAgentRuntimeDescriptor(runtime as any))
    .filter((runtime): runtime is GatewayAgentRuntimeDescriptor => runtime !== undefined);
}

export async function showRustAgentRuntime(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayAgentRuntimeDescriptor | undefined> {
  return fromWireAgentRuntimeDescriptor((await call('agents.show', { id })) as any);
}

export async function unregisterRustAgentRuntime(
  call: RustGatewayCall,
  id: string,
): Promise<GatewayAgentRuntimeDescriptor | undefined> {
  return fromWireAgentRuntimeDescriptor((await call('agents.unregister', { id })) as any);
}
