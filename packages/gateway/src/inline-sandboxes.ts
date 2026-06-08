import type { GatewaySandboxLease } from './types-sandboxes.js';

type InlineSandboxLogger = (
  level: string,
  target: string | undefined,
  message: string,
  data?: unknown,
) => void;

export class InlineSandboxStore {
  #leases = new Map<string, GatewaySandboxLease>();

  constructor(private readonly log: InlineSandboxLogger) {}

  register(input: GatewaySandboxLease): GatewaySandboxLease {
    const lease = normalizeSandboxLease(input);
    this.#leases.set(lease.id, lease);
    this.log('info', lease.id, 'sandbox lease registered');
    return lease;
  }

  list(): GatewaySandboxLease[] {
    this.expire(Date.now());
    return [...this.#leases.values()].sort((a, b) => b.acquiredAtMs - a.acquiredAtMs);
  }

  show(id: string): GatewaySandboxLease | undefined {
    this.expire(Date.now());
    return this.#leases.get(sandboxId('sandbox lease id', id));
  }

  release(id: string): GatewaySandboxLease | undefined {
    const lease = this.show(id);
    if (!lease) return undefined;
    this.#leases.delete(lease.id);
    this.log('info', lease.id, 'sandbox lease released');
    return lease;
  }

  expire(nowMs: number): number {
    let count = 0;
    for (const lease of this.#leases.values()) {
      if (lease.expiresAtMs === undefined || lease.expiresAtMs > nowMs) continue;
      this.#leases.delete(lease.id);
      this.log('warn', lease.id, 'sandbox lease expired');
      count++;
    }
    return count;
  }
}

function normalizeSandboxLease(input: GatewaySandboxLease): GatewaySandboxLease {
  const lease: GatewaySandboxLease = {
    id: sandboxId('sandbox lease id', input.id),
    sandboxId: sandboxId('sandbox id', input.sandboxId),
    cwd: requiredField('sandbox cwd', input.cwd),
    acquiredAtMs: Number(input.acquiredAtMs || Date.now()),
    expiresAtMs: input.expiresAtMs,
    backend: input.backend ?? 'worktree',
    project: input.project
      ? {
          id: requiredField('sandbox project id', input.project.id),
          root: requiredField('sandbox project root', input.project.root),
          branch: input.project.branch,
        }
      : undefined,
    referenceRoots: (input.referenceRoots ?? []).map((root) =>
      requiredField('sandbox reference root', root),
    ),
  };
  return lease;
}

function sandboxId(field: string, value: string): string {
  const id = requiredField(field, value);
  if (id.length > 128) throw new Error(`${field} must be 128 characters or fewer`);
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error(`${field} must contain only letters, numbers, ".", "_", "-", or ":"`);
  }
  return id;
}

function requiredField(field: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must be non-empty`);
  return normalized;
}
