import type { GatewayProjectRef, GatewaySandboxLease } from './types-sandboxes.js';

export interface WireProjectRef {
  id: string;
  root: string;
  branch?: string | null;
}

export interface WireSandboxLease {
  id: string;
  sandbox_id: string;
  cwd: string;
  acquired_at_ms: number;
  expires_at_ms?: number | null;
  backend?: string | null;
  project?: WireProjectRef | null;
  reference_roots?: string[];
}

export function toWireSandboxLease(lease: GatewaySandboxLease): Record<string, unknown> {
  return {
    id: lease.id,
    sandbox_id: lease.sandboxId,
    cwd: lease.cwd,
    acquired_at_ms: lease.acquiredAtMs,
    expires_at_ms: lease.expiresAtMs ?? null,
    backend: lease.backend ?? 'worktree',
    project: lease.project ? toWireProjectRef(lease.project) : null,
    reference_roots: lease.referenceRoots ?? [],
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
    backend: fromWireSandboxBackend(value.backend),
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

function fromWireSandboxBackend(value: string | null | undefined): 'worktree' | undefined {
  if (!value) return undefined;
  return value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase() === 'worktree'
    ? 'worktree'
    : undefined;
}
