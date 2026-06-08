import type { GatewaySandboxLease } from './types-sandboxes.js';
import type {
  GatewayWorkerHeartbeat,
  GatewayWorkerProcess,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types-workers.js';

export type {
  GatewayWorkerHeartbeat,
  GatewayWorkerProcess,
  GatewayWorkerProcessState,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
  GatewayWorkerState,
} from './types-workers.js';
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
  workers?: GatewayWorkerRecord[];
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

export interface GatewayTransport {
  readonly runtime: GatewayRuntime;
  send(envelope: GatewayEnvelope): Promise<void>;
  receive(actor: ActorId, filter?: GatewayReceiveFilter): Promise<GatewayEnvelope | undefined>;
  status(): Promise<GatewayStatus>;
}

export interface GatewayServiceRunner {
  run(signal?: AbortSignal): Promise<{ summary?: string } | undefined>;
}

export interface GatewayClient extends GatewayTransport {
  registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void>;
  enableService(name: string, enabled: boolean): Promise<void>;
  runService(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined>;
  listServices(): Promise<GatewayServiceStatus[]>;
  registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor>;
  listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]>;
  showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined>;
  registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord>;
  heartbeatWorker(heartbeat: GatewayWorkerHeartbeat): Promise<GatewayWorkerRecord | undefined>;
  listWorkers(): Promise<GatewayWorkerRecord[]>;
  showWorker(id: string): Promise<GatewayWorkerRecord | undefined>;
  registerCapability(capability: string, actor: ActorId): Promise<void>;
  whereisCapability(capability: string): Promise<ActorId[]>;
  registrySnapshot(): Promise<GatewayRegistrySnapshot>;
  createTable(name: string, owner: ActorId, access?: GatewayTableAccess): Promise<boolean>;
  tableNames(): Promise<string[]>;
  tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined>;
  enqueueJob(spec: GatewayJobSpec, id?: string): Promise<GatewayJobStatus>;
  listJobs(): Promise<GatewayJobStatus[]>;
  showJob(id: string): Promise<GatewayJobStatus | undefined>;
  cancelJob(id: string): Promise<GatewayJobStatus | undefined>;
  retryJob(id: string): Promise<GatewayJobStatus | undefined>;
  acquireJob(queue: string, worker: string, leaseMs?: number): Promise<GatewayJobLease | undefined>;
  completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined>;
  failJob(id: string, error: string): Promise<GatewayJobStatus | undefined>;
  appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord>;
  listEvents(): Promise<GatewayEventRecord[]>;
  cancelEvent(id: string): Promise<GatewayEventRecord | undefined>;
  appendLog(input: GatewayLogInput): Promise<GatewayLogRecord>;
  tailLogs(options?: { target?: string; limit?: number }): Promise<GatewayLogRecord[]>;
  registerSandboxLease(lease: GatewaySandboxLease): Promise<GatewaySandboxLease>;
  listSandboxLeases(): Promise<GatewaySandboxLease[]>;
  showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined>;
  releaseSandboxLease(id: string): Promise<GatewaySandboxLease | undefined>;
}
