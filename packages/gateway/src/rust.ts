import {
  listRustAgentRuntimes,
  registerRustAgentRuntime,
  showRustAgentRuntime,
} from './rust-agents.js';
import { RustGatewayConnection } from './rust-connection.js';
import {
  appendRustEvent,
  appendRustLog,
  cancelRustEvent,
  listRustEvents,
  tailRustLogs,
} from './rust-events.js';
import {
  acquireRustJob,
  cancelRustJob,
  completeRustJob,
  enqueueRustJob,
  failRustJob,
  listRustJobs,
  renewRustJob,
  retryRustJob,
  showRustJob,
} from './rust-jobs.js';
import {
  receiveRustEnvelope,
  registerRustCapability,
  rustRegistrySnapshot,
  sendRustEnvelope,
  whereisRustCapability,
} from './rust-messaging.js';
import type { RustGatewayClientOptions } from './rust-options.js';
import {
  listRustSandboxLeases,
  registerRustSandboxLease,
  releaseRustSandboxLease,
  showRustSandboxLease,
} from './rust-sandboxes.js';
import { listRustServices, runRustService } from './rust-services.js';
import { createRustTable, listRustTables, showRustTable } from './rust-tables.js';
import { toWireServiceSpec } from './rust-wire.js';
import { fromWireStatus } from './rust-wire-status.js';
import {
  heartbeatRustWorker,
  listRustWorkers,
  registerRustWorker,
  showRustWorker,
} from './rust-workers.js';
import type {
  ActorId,
  GatewayAgentRuntimeDescriptor,
  GatewayEnvelope,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLeaseFence,
  GatewayLogInput,
  GatewayLogRecord,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';
import type {
  GatewayOrchestrationClient,
  GatewayWorldSnapshot,
  GatewayWorldSnapshotOptions,
} from './types-runtime.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';
import { buildGatewayWorldSnapshot } from './world.js';

export type { RustGatewayClientOptions } from './rust-options.js';

export class RustGatewayClient implements GatewayOrchestrationClient {
  readonly runtime = 'rust' as const;
  #serviceRunTimeoutMs: number;
  #runners = new Map<string, GatewayServiceRunner>();
  #gatewayCall;

  constructor(options: RustGatewayClientOptions) {
    this.#gatewayCall = new RustGatewayConnection(
      options.socketPath,
      options.timeoutMs ?? 2_000,
    ).call;
    this.#serviceRunTimeoutMs = options.serviceRunTimeoutMs ?? 300_000;
  }
  async send(envelope: GatewayEnvelope): Promise<void> {
    await sendRustEnvelope(this.#gatewayCall, envelope);
  }
  async receive(
    actor: ActorId,
    filter: GatewayReceiveFilter = {},
  ): Promise<GatewayEnvelope | undefined> {
    return receiveRustEnvelope(this.#gatewayCall, actor, filter);
  }

  async status(): Promise<GatewayStatus> {
    return fromWireStatus((await this.#gatewayCall('status')) as any);
  }
  async registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    if (runner) this.#runners.set(spec.name, runner);
    await this.#gatewayCall('services.register', { spec: toWireServiceSpec(spec) });
  }
  async enableService(name: string, enabled: boolean): Promise<void> {
    await this.#gatewayCall('services.enable', { name, enabled });
  }
  async runService(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined> {
    return runRustService(
      this.#gatewayCall,
      name,
      this.#runners.get(name),
      this.#serviceRunTimeoutMs,
      signal,
    );
  }
  async listServices(): Promise<GatewayServiceStatus[]> {
    return listRustServices(this.#gatewayCall);
  }
  async registerCapability(capability: string, actor: ActorId): Promise<void> {
    await registerRustCapability(this.#gatewayCall, capability, actor);
  }
  async whereisCapability(capability: string): Promise<ActorId[]> {
    return whereisRustCapability(this.#gatewayCall, capability);
  }
  async registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return rustRegistrySnapshot(this.#gatewayCall);
  }
  async registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    return registerRustAgentRuntime(this.#gatewayCall, descriptor);
  }
  async listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]> {
    return listRustAgentRuntimes(this.#gatewayCall);
  }
  async showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return showRustAgentRuntime(this.#gatewayCall, id);
  }
  async registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord> {
    return registerRustWorker(this.#gatewayCall, worker);
  }
  async heartbeatWorker(
    heartbeat: GatewayWorkerHeartbeat,
  ): Promise<GatewayWorkerRecord | undefined> {
    return heartbeatRustWorker(this.#gatewayCall, heartbeat);
  }

  async listWorkers(): Promise<GatewayWorkerRecord[]> {
    return listRustWorkers(this.#gatewayCall);
  }
  async showWorker(id: string): Promise<GatewayWorkerRecord | undefined> {
    return showRustWorker(this.#gatewayCall, id);
  }
  async createTable(
    name: string,
    owner: ActorId,
    access: GatewayTableAccess = 'protected',
  ): Promise<boolean> {
    return createRustTable(this.#gatewayCall, name, owner, access);
  }

  async tableNames(): Promise<string[]> {
    return listRustTables(this.#gatewayCall);
  }
  async tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined> {
    return showRustTable(this.#gatewayCall, name);
  }
  async enqueueJob(spec: GatewayJobSpec, id?: string): Promise<GatewayJobStatus> {
    return enqueueRustJob(this.#gatewayCall, spec, id);
  }
  async listJobs(): Promise<GatewayJobStatus[]> {
    return listRustJobs(this.#gatewayCall);
  }
  async showJob(id: string): Promise<GatewayJobStatus | undefined> {
    return showRustJob(this.#gatewayCall, id);
  }
  async cancelJob(id: string): Promise<GatewayJobStatus | undefined> {
    return cancelRustJob(this.#gatewayCall, id);
  }
  async retryJob(id: string): Promise<GatewayJobStatus | undefined> {
    return retryRustJob(this.#gatewayCall, id);
  }
  async acquireJob(
    queue: string,
    worker: string,
    leaseMs = 300_000,
  ): Promise<GatewayJobLease | undefined> {
    return acquireRustJob(this.#gatewayCall, queue, worker, leaseMs);
  }

  async renewJob(
    id: string,
    fence: GatewayLeaseFence,
    leaseMs = 300_000,
  ): Promise<GatewayJobLease | undefined> {
    return renewRustJob(this.#gatewayCall, id, fence, leaseMs);
  }
  async completeJob(
    id: string,
    result: unknown,
    fence: GatewayLeaseFence,
  ): Promise<GatewayJobStatus | undefined> {
    return completeRustJob(this.#gatewayCall, id, result, fence);
  }
  async failJob(
    id: string,
    error: string,
    fence: GatewayLeaseFence,
  ): Promise<GatewayJobStatus | undefined> {
    return failRustJob(this.#gatewayCall, id, error, fence);
  }
  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord> {
    return appendRustEvent(this.#gatewayCall, input);
  }
  async listEvents(): Promise<GatewayEventRecord[]> {
    return listRustEvents(this.#gatewayCall);
  }
  async cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return cancelRustEvent(this.#gatewayCall, id);
  }
  async appendLog(input: GatewayLogInput): Promise<GatewayLogRecord> {
    return appendRustLog(this.#gatewayCall, input);
  }
  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    return tailRustLogs(this.#gatewayCall, options);
  }
  async registerSandboxLease(lease: GatewaySandboxLease): Promise<GatewaySandboxLease> {
    return registerRustSandboxLease(this.#gatewayCall, lease);
  }
  async listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return listRustSandboxLeases(this.#gatewayCall);
  }
  async showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return showRustSandboxLease(this.#gatewayCall, id);
  }
  async releaseSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return releaseRustSandboxLease(this.#gatewayCall, id);
  }
  async worldSnapshot(options: GatewayWorldSnapshotOptions = {}): Promise<GatewayWorldSnapshot> {
    return buildGatewayWorldSnapshot(this, options);
  }
}
