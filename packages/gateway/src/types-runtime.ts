export interface GatewayAgentRunSpec {
  prompt: string;
  provider?: string;
  model?: string;
  configPath?: string;
  profile?: string;
  channel?: string;
  cwd?: string;
  toolsets?: string[];
  session?: 'new' | 'resume' | 'none';
  sessionId?: string;
  maxContextTokens?: number;
  outputArtifact?: string;
}

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

export interface GatewayExtensionContributions {
  services?: import('./types.js').GatewayServiceSpec[];
  appliances?: GatewayApplianceDescriptor[];
  capabilities?: string[];
}

export interface GatewayApplianceDescriptor {
  id: string;
  name: string;
  version?: string;
  root?: string;
  capabilities?: string[];
  resources?: string[];
}
