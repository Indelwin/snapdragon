export interface GatewayProjectRef {
  id: string;
  root: string;
  branch?: string;
}

export interface GatewaySandboxSpec {
  id?: string;
  leaseId?: string;
  sandboxId?: string;
  cwd?: string;
  project: GatewayProjectRef;
  backend?: 'worktree';
  referenceRoots?: string[];
  inheritEnv?: boolean;
  ttlMs?: number;
  expiresAtMs?: number;
  acquiredAtMs?: number;
}

export interface GatewaySandboxLease {
  id: string;
  sandboxId: string;
  cwd: string;
  acquiredAtMs: number;
  expiresAtMs?: number;
  backend?: 'worktree';
  project?: GatewayProjectRef;
  referenceRoots?: string[];
}
