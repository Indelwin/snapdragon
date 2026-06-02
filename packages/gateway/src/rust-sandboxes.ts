import type { RustGatewayCall } from './rust-call.js';
import { fromWireSandboxLease, toWireSandboxSpec } from './rust-wire-sandboxes.js';
import type { GatewaySandboxLease, GatewaySandboxSpec } from './types.js';

export async function leaseRustSandbox(
  call: RustGatewayCall,
  spec: GatewaySandboxSpec,
): Promise<GatewaySandboxLease> {
  return requireSandbox(
    fromWireSandboxLease((await call('sandboxes.lease', { spec: toWireSandboxSpec(spec) })) as any),
  );
}

export async function listRustSandboxes(call: RustGatewayCall): Promise<GatewaySandboxLease[]> {
  return ((await call('sandboxes.list')) as any[]).map((lease) =>
    requireSandbox(fromWireSandboxLease(lease)),
  );
}

export async function showRustSandbox(
  call: RustGatewayCall,
  id: string,
): Promise<GatewaySandboxLease | undefined> {
  return fromWireSandboxLease((await call('sandboxes.show', { id })) as any);
}

export async function releaseRustSandbox(
  call: RustGatewayCall,
  id: string,
): Promise<GatewaySandboxLease | undefined> {
  return fromWireSandboxLease((await call('sandboxes.release', { id })) as any);
}

function requireSandbox(lease: GatewaySandboxLease | undefined): GatewaySandboxLease {
  if (!lease) throw new Error('Gateway returned no sandbox lease');
  return lease;
}
