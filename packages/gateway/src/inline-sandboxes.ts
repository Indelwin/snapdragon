import { activeSandboxLeases, gatewaySandboxLeaseFromSpec } from './sandbox-validation.js';
import type { GatewaySandboxLease, GatewaySandboxSpec } from './types.js';

type InlineLog = (
  level: string,
  target: string | undefined,
  message: string,
  data?: unknown,
) => void;

export class InlineSandboxStore {
  #leases = new Map<string, GatewaySandboxLease>();

  constructor(private readonly log: InlineLog) {}

  lease(spec: GatewaySandboxSpec): GatewaySandboxLease {
    const lease = gatewaySandboxLeaseFromSpec(spec);
    this.#leases.set(lease.id, lease);
    this.log('info', lease.id, 'sandbox lease acquired', { sandboxId: lease.sandboxId });
    return lease;
  }

  list(): GatewaySandboxLease[] {
    return activeSandboxLeases(this.#leases.values());
  }

  show(id: string): GatewaySandboxLease | undefined {
    const lease = this.#leases.get(id);
    return lease ? activeSandboxLeases([lease])[0] : undefined;
  }

  release(id: string): GatewaySandboxLease | undefined {
    const lease = this.show(id);
    if (!lease) return undefined;
    this.#leases.delete(id);
    this.log('info', id, 'sandbox lease released', { sandboxId: lease.sandboxId });
    return lease;
  }
}
