import type {
  GatewayAgentRuntimeDescriptor,
  GatewayClient,
  GatewayEventRecord,
  GatewayEventState,
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayLogRecord,
  GatewayQueueDepth,
  GatewayRegistrySnapshot,
  GatewayServiceSpec,
  GatewayServiceState,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableSnapshot,
  GatewayWorkerProcess,
  GatewayWorkerProcessState,
} from './types.js';

export type {
  GatewayAgentRuntimeDescriptor,
  GatewayAgentRuntimeHealth,
  GatewayAgentRuntimeIsolation,
  GatewayAgentRuntimeKind,
  GatewayAgentRuntimeProtocol,
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
  workers: GatewayWorkerProcess[];
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

export type GatewayWorldSnapshotSection =
  | 'services'
  | 'agentRuntimes'
  | 'workers'
  | 'workerProcesses'
  | 'jobs'
  | 'events'
  | 'logs'
  | 'registry'
  | 'leases'
  | 'queueDepths'
  | 'tables'
  | 'sandboxes';

export interface GatewayWorldSnapshotOptions {
  sections?: GatewayWorldSnapshotSection[];
  target?: string;
  queue?: string;
  runtimeId?: string;
  service?: string;
  worker?: string;
  workerState?: GatewayWorkerProcessState;
  capability?: string;
  serviceState?: GatewayServiceState;
  serviceEnabled?: boolean;
  jobKind?: string;
  jobState?: GatewayJobState;
  eventKind?: string;
  eventState?: GatewayEventState;
  logLimit?: number;
  tables?: string[];
}

export interface GatewayOrchestrationClient extends GatewayClient {
  worldSnapshot(options?: GatewayWorldSnapshotOptions): Promise<GatewayWorldSnapshot>;
}
