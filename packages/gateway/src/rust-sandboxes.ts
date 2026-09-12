import type { RustGatewayCall } from './rust-call.js';
import { readAllRustPages } from './rust-pages.js';
import { fromWireSandboxLease, toWireSandboxLease } from './rust-wire-sandboxes.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';

export async function registerRustSandboxLease(
  call: RustGatewayCall,
  lease: GatewaySandboxLease,
): Promise<GatewaySandboxLease> {
  const registered = fromWireSandboxLease(
    (await call('sandboxes.register', { lease: toWireSandboxLease(lease) })) as any,
  );
  if (!registered) throw new Error('Gateway returned no sandbox lease for sandboxes.register');
  return registered;
}

export async function listRustSandboxLeases(call: RustGatewayCall): Promise<GatewaySandboxLease[]> {
  return readAllRustPages(call, 'sandboxes.list', (lease) => fromWireSandboxLease(lease as any));
}

export async function showRustSandboxLease(
  call: RustGatewayCall,
  id: string,
): Promise<GatewaySandboxLease | undefined> {
  return fromWireSandboxLease((await call('sandboxes.show', { id })) as any);
}

export async function releaseRustSandboxLease(
  call: RustGatewayCall,
  id: string,
): Promise<GatewaySandboxLease | undefined> {
  return fromWireSandboxLease((await call('sandboxes.release', { id })) as any);
}
