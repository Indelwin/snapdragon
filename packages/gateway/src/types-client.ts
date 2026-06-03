import type {
  ActorId,
  GatewayAgentRuntimeDescriptor,
  GatewayEnvelope,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLogInput,
  GatewayLogRecord,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayRuntime,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types-core.js';
import type { GatewaySandboxLease, GatewaySandboxSpec } from './types-sandboxes.js';

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
  unregisterAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined>;
  registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord>;
  heartbeatWorker(heartbeat: GatewayWorkerHeartbeat): Promise<GatewayWorkerRecord | undefined>;
  listWorkers(): Promise<GatewayWorkerRecord[]>;
  showWorker(id: string): Promise<GatewayWorkerRecord | undefined>;
  unregisterWorker(id: string): Promise<GatewayWorkerRecord | undefined>;
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
  leaseSandbox(spec: GatewaySandboxSpec): Promise<GatewaySandboxLease>;
  listSandboxLeases(): Promise<GatewaySandboxLease[]>;
  showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined>;
  releaseSandbox(id: string): Promise<GatewaySandboxLease | undefined>;
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
}
