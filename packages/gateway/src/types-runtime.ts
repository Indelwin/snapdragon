import type {
  GatewayAgentRuntimeDescriptor,
  GatewayClient,
  GatewayEventRecord,
  GatewayJobStatus,
  GatewayLease,
  GatewayLogRecord,
  GatewayProjectRef,
  GatewayQueueDepth,
  GatewayRegistrySnapshot,
  GatewaySandboxLease,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableSnapshot,
  GatewayWorkerProcess,
  GatewayWorkerRecord,
} from './types.js';

export type {
  GatewayAgentRuntimeDescriptor,
  GatewayAgentRuntimeHealth,
  GatewayAgentRuntimeIsolation,
  GatewayAgentRuntimeKind,
  GatewayAgentRuntimeProtocol,
  GatewayProjectRef,
  GatewaySandboxLease,
  GatewaySandboxSpec,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
  GatewayWorkerState,
} from './types.js';

export interface GatewayPolicyHints {
  approvalRequired?: boolean;
  scopes?: string[];
  maxToolCalls?: number;
  maxRuntimeMs?: number;
}

export interface GatewayAgentRunSpec {
  prompt: string;
  parentJobId?: string;
  correlationId?: string;
  targetRuntimeId?: string;
  provider?: string;
  model?: string;
  configPath?: string;
  profile?: string;
  channel?: string;
  cwd?: string;
  project?: GatewayProjectRef;
  sandboxLease?: GatewaySandboxLease;
  policyHints?: GatewayPolicyHints;
  priority?: number;
  toolsets?: string[];
  session?: 'new' | 'resume' | 'none';
  sessionId?: string;
  maxContextTokens?: number;
  outputArtifact?: string;
}

export interface GatewayAgentRuntimeObservedEvent {
  type: string;
  atMs: number;
  payload: Record<string, unknown>;
}

export interface GatewayExtensionContributions {
  services?: GatewayServiceSpec[];
  appliances?: GatewayApplianceDescriptor[];
  capabilities?: string[];
  agentRuntimes?: GatewayAgentRuntimeDescriptor[];
}

export interface GatewayApplianceDescriptor {
  id: string;
  name: string;
  version?: string;
  root?: string;
  capabilities?: string[];
  resources?: string[];
}

export interface GatewayWorldSnapshot {
  capturedAtMs: number;
  runtime: GatewayStatus['runtime'];
  status: GatewayStatus;
  services: GatewayServiceStatus[];
  agentRuntimes: GatewayAgentRuntimeDescriptor[];
  workers: GatewayWorkerRecord[];
  workerProcesses: GatewayWorkerProcess[];
  jobs: GatewayJobStatus[];
  events: GatewayEventRecord[];
  logs: GatewayLogRecord[];
  registry: GatewayRegistrySnapshot;
  leases: GatewayLease[];
  queueDepths: GatewayQueueDepth[];
  tables: GatewayTableSnapshot[];
  sandboxes: GatewaySandboxLease[];
}

export interface GatewayOrchestrationClient extends GatewayClient {
  worldSnapshot(): Promise<GatewayWorldSnapshot>;
}
