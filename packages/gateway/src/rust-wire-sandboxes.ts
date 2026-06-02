import { gatewaySandboxLeaseFromSpec } from './sandbox-validation.js';
import type { GatewayProjectRef, GatewaySandboxLease, GatewaySandboxSpec } from './types.js';

interface WireProjectRef {
  id: string;
  root: string;
  branch?: string | null;
}

interface WireSandboxLease {
  id: string;
  sandbox_id: string;
  cwd: string;
  acquired_at_ms: number;
  expires_at_ms?: number | null;
  backend?: string | null;
  project?: WireProjectRef | null;
  reference_roots?: string[];
}

export function toWireSandboxSpec(spec: GatewaySandboxSpec): Record<string, unknown> {
  const lease = gatewaySandboxLeaseFromSpec(spec);
  return {
    id: lease.sandboxId,
    lease_id: lease.id,
    sandbox_id: lease.sandboxId,
    cwd: lease.cwd,
    project: toWireProjectRef(lease.project as GatewayProjectRef),
    backend: lease.backend ?? null,
    reference_roots: lease.referenceRoots ?? [],
    inherit_env: spec.inheritEnv ?? false,
    ttl_ms: null,
    expires_at_ms: lease.expiresAtMs ?? null,
    acquired_at_ms: lease.acquiredAtMs,
  };
}

export function fromWireSandboxLease(
  value: WireSandboxLease | undefined,
): GatewaySandboxLease | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    sandboxId: value.sandbox_id,
    cwd: value.cwd,
    acquiredAtMs: Number(value.acquired_at_ms ?? 0),
    expiresAtMs: value.expires_at_ms ?? undefined,
    backend: value.backend === 'worktree' ? 'worktree' : undefined,
    project: fromWireProjectRef(value.project ?? undefined),
    referenceRoots: value.reference_roots ?? [],
  };
}

function toWireProjectRef(project: GatewayProjectRef): Record<string, unknown> {
  return {
    id: project.id,
    root: project.root,
    branch: project.branch ?? null,
  };
}

function fromWireProjectRef(value: WireProjectRef | undefined): GatewayProjectRef | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    root: value.root,
    branch: value.branch ?? undefined,
  };
}
