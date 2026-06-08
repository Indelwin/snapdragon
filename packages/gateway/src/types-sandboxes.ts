export interface GatewayProjectRef {
  id: string;
  root: string;
  branch?: string;
}

export interface GatewaySandboxSpec {
  id?: string;
  project: GatewayProjectRef;
  backend?: 'worktree';
  referenceRoots?: string[];
  inheritEnv?: boolean;
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
