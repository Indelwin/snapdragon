import type { GatewayProjectRef, GatewaySandboxLease, GatewaySandboxSpec } from './types.js';

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export function gatewaySandboxLeaseFromSpec(
  spec: GatewaySandboxSpec,
  nowMs = Date.now(),
): GatewaySandboxLease {
  const project = projectRef(spec.project);
  const sandboxId = sandboxIdentifier(spec.sandboxId ?? spec.id ?? `sandbox_${nowMs}`);
  const expiresAtMs = spec.expiresAtMs ?? (spec.ttlMs ? nowMs + spec.ttlMs : undefined);
  if (expiresAtMs !== undefined && expiresAtMs <= nowMs) {
    throw new Error('gateway sandbox lease expiry must be in the future');
  }
  return {
    id: sandboxIdentifier(spec.leaseId ?? `lease_${sandboxId}`),
    sandboxId,
    cwd: nonEmptyString('cwd', spec.cwd ?? project.root),
    acquiredAtMs: spec.acquiredAtMs ?? nowMs,
    expiresAtMs,
    backend: spec.backend ?? 'worktree',
    project,
    referenceRoots: spec.referenceRoots?.map((root, index) =>
      nonEmptyString(`referenceRoots[${index}]`, root),
    ),
  };
}

function projectRef(value: unknown): GatewayProjectRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('gateway sandbox project must be an object');
  }
  const project = value as { id?: string; root?: string; branch?: string };
  return {
    id: nonEmptyString('project.id', project.id),
    root: nonEmptyString('project.root', project.root),
    branch: project.branch ? nonEmptyString('project.branch', project.branch) : undefined,
  };
}

export function activeSandboxLeases(
  leases: Iterable<GatewaySandboxLease>,
  nowMs = Date.now(),
): GatewaySandboxLease[] {
  return [...leases]
    .filter((lease) => lease.expiresAtMs === undefined || lease.expiresAtMs > nowMs)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function sandboxIdentifier(value: string): string {
  const id = nonEmptyString('id', value);
  if (!idPattern.test(id)) {
    throw new Error(
      'gateway sandbox id must start with a letter or number and contain only letters, numbers, ".", "_", "-", or ":"',
    );
  }
  return id;
}

function nonEmptyString(field: string, value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`gateway sandbox ${field} must be a non-empty string`);
  }
  return value.trim();
}
