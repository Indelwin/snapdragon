import {
  listRustAgentRuntimes,
  registerRustAgentRuntime,
  showRustAgentRuntime,
} from './rust-agents.js';
import type { RustGatewayCall } from './rust-call.js';
import {
  appendRustEvent,
  appendRustLog,
  cancelRustEvent,
  listRustEvents,
  tailRustLogs,
} from './rust-events.js';
import { request } from './rust-ipc.js';
import {
  acquireRustJob,
  cancelRustJob,
  completeRustJob,
  enqueueRustJob,
  failRustJob,
  listRustJobs,
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
import type { GatewayOrchestrationClient } from './types-runtime.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';
import { buildGatewayWorldSnapshot } from './world.js';

export type { RustGatewayClientOptions } from './rust-options.js';

export class RustGatewayClient implements GatewayOrchestrationClient {
  readonly runtime = 'rust' as const;
  #socketPath: string;
  #timeoutMs: number;
  #serviceRunTimeoutMs: number;
  #nextId = 1;
  #runners = new Map<string, GatewayServiceRunner>();
  #gatewayCall: RustGatewayCall = (method, params, timeoutMs) =>
    this.#call(method, params, timeoutMs);

  constructor(options: RustGatewayClientOptions) {
    this.#socketPath = options.socketPath;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
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
    return fromWireStatus((await this.#call('status')) as any);
  }
  async registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    if (runner) this.#runners.set(spec.name, runner);
    await this.#call('services.register', { spec: toWireServiceSpec(spec) });
  }
  async enableService(name: string, enabled: boolean): Promise<void> {
    await this.#call('services.enable', { name, enabled });
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

  async completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined> {
    return completeRustJob(this.#gatewayCall, id, result);
  }
  async failJob(id: string, error: string): Promise<GatewayJobStatus | undefined> {
    return failRustJob(this.#gatewayCall, id, error);
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
  worldSnapshot = () => buildGatewayWorldSnapshot(this);
  async #call(method: string, params: unknown = {}, timeoutMs = this.#timeoutMs): Promise<unknown> {
    const id = this.#nextId++;
    const response = await request(this.#socketPath, { id, method, params }, timeoutMs);
    if (!response.ok) throw new Error(response.error ?? `Gateway IPC ${method} failed`);
    return response.result;
  }
}
