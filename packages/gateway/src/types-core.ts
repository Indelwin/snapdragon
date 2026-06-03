export type {
  GatewayProjectRef,
  GatewaySandboxLease,
  GatewaySandboxSpec,
} from './types-sandboxes.js';

export type GatewayRuntime = 'rust' | 'inline-ts';

export interface ActorId {
  id: string;
}

export interface GatewayEnvelope {
  id: number;
  kind: string;
  target: ActorId;
  source?: ActorId;
  correlationId?: string;
  capability?: string;
  payload: unknown;
  insertedAtMs: number;
}

export interface GatewayReceiveFilter {
  kind?: string;
  source?: ActorId;
  correlationId?: string;
  capability?: string;
}

export type GatewaySupervisorStrategy = 'one_for_one' | 'one_for_all' | 'rest_for_one';
export type GatewayChildRestart = 'permanent' | 'transient' | 'temporary';
export type GatewayTableAccess = 'public' | 'protected' | 'private';
export type GatewayServiceState = 'starting' | 'running' | 'stopped' | 'failed';
export type GatewayJobState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type GatewayEventState = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
export type GatewayWorkerProcessState = 'running' | 'exited' | 'timed_out' | 'failed';
export type GatewayWorkerState = 'idle' | 'running' | 'offline';
export type GatewayAgentRuntimeKind = 'sd' | 'codex' | 'hermes' | 'pi' | 'custom';
export type GatewayAgentRuntimeProtocol = 'embedded' | 'command' | 'jsonl' | 'http' | 'stdio';
export type GatewayAgentRuntimeIsolation = 'inherit' | 'profile' | 'channel' | 'sandbox';

export interface GatewayAgentRuntimeHealth {
  state: string;
  checkedAtMs: number;
  message?: string;
}

export interface GatewayAgentRuntimeDescriptor {
  id: string;
  kind: GatewayAgentRuntimeKind;
  protocol: GatewayAgentRuntimeProtocol;
  label?: string;
  command?: GatewayServiceSpec['worker'];
  supportedJobKinds?: string[];
  capabilities?: string[];
  isolation?: GatewayAgentRuntimeIsolation;
  health?: GatewayAgentRuntimeHealth;
  metadata?: Record<string, unknown>;
}

export interface GatewayBudgetConfig {
  maxFuel?: number;
  timeoutMs?: number;
}

export interface GatewayServiceWorkerSpec {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface GatewayServiceSpec {
  name: string;
  enabled?: boolean;
  intervalMs?: number;
  startupDelayMs?: number;
  budget?: GatewayBudgetConfig;
  restart?: GatewayChildRestart;
  restartIntensity?: { maxRestarts?: number; withinMs?: number };
  backoffMs?: number;
  maxBackoffMs?: number;
  worker?: GatewayServiceWorkerSpec;
}

export interface GatewayServiceStatus {
  name: string;
  enabled: boolean;
  state: GatewayServiceState;
  runs: number;
  errors: number;
  consecutiveErrors?: number;
  lastRunAtMs?: number;
  lastError?: string;
  lastSummary?: string;
  restartSuppressed?: boolean;
  nextRunAtMs?: number;
  lastExitReason?: string;
}

export interface GatewayStatus {
  runtime: GatewayRuntime;
  services: GatewayServiceStatus[];
  agentRuntimes?: GatewayAgentRuntimeDescriptor[];
  processes: number;
  workerProcesses?: GatewayWorkerProcess[];
  tables: string[];
  serviceTasks?: string[];
  jobsPending?: number;
  jobsRunning?: number;
  activeLeases?: GatewayLease[];
  queueDepths?: GatewayQueueDepth[];
  recentLogs?: GatewayLogRecord[];
  recentFailures?: GatewayLogRecord[];
  uptimeMs?: number;
  pid?: number;
}

export interface GatewayWorkerProcess {
  id: string;
  service: string;
  pid?: number;
  command: string;
  args: string[];
  cwd?: string;
  startedAtMs: number;
  finishedAtMs?: number;
  timeoutMs?: number;
  state: GatewayWorkerProcessState;
  exitCode?: number;
  signal?: string;
  lastError?: string;
}

export interface GatewayWorkerRegistration {
  id: string;
  queue?: string;
  runtimeId?: string;
  service?: string;
  capabilities?: string[];
  status?: string;
  metadata?: unknown;
}

export interface GatewayWorkerHeartbeat {
  id: string;
  state?: GatewayWorkerState;
  queue?: string;
  status?: string;
  lastError?: string;
  metadata?: unknown;
}

export interface GatewayWorkerRecord {
  id: string;
  queue: string;
  runtimeId?: string;
  service?: string;
  capabilities: string[];
  state: GatewayWorkerState;
  registeredAtMs: number;
  heartbeatAtMs: number;
  currentJobId?: string;
  currentLeaseId?: string;
  leaseExpiresAtMs?: number;
  status?: string;
  lastError?: string;
  metadata?: unknown;
}

export interface GatewayRegistrySnapshot {
  names: Record<string, ActorId>;
  capabilities: Record<string, ActorId[]>;
  channels: Record<string, ActorId>;
}

export interface GatewayTableSnapshot {
  name: string;
  owner: ActorId;
  access: GatewayTableAccess;
  rows: number;
}

export interface GatewayJobSpec {
  kind: string;
  queue?: string;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface GatewayJobStatus {
  id: string;
  spec: Required<Omit<GatewayJobSpec, 'timeoutMs'>> & Pick<GatewayJobSpec, 'timeoutMs'>;
  state: GatewayJobState;
  attempts: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseId?: string;
  leaseExpiresAtMs?: number;
  lastError?: string;
  result?: unknown;
}

export interface GatewayLease {
  id: string;
  jobId: string;
  worker: string;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export interface GatewayQueueDepth {
  queue: string;
  pending: number;
  running: number;
}

export interface GatewayJobLease {
  job: GatewayJobStatus;
  lease: GatewayLease;
}

export interface GatewayEventRecord {
  id: string;
  kind: string;
  target?: string;
  state: GatewayEventState;
  payload?: unknown;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface GatewayLogRecord {
  id: number;
  atMs: number;
  level: string;
  target?: string;
  message: string;
  data?: unknown;
}

export interface GatewayLogInput {
  level?: string;
  target?: string;
  message: string;
  data?: unknown;
  atMs?: number;
}
