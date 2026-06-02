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
  leaseRustSandbox,
  listRustSandboxes,
  releaseRustSandbox,
  showRustSandbox,
} from './rust-sandboxes.js';
import { createRustTable, listRustTables, showRustTable } from './rust-tables.js';
import { toWireServiceSpec } from './rust-wire.js';
import { fromWireServiceStatus, fromWireStatus } from './rust-wire-status.js';
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
  GatewaySandboxLease,
  GatewaySandboxSpec,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
} from './types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';
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
    const runner = this.#runners.get(name);
    if (!runner) {
      const status = await this.#call('services.run', { name }, this.#serviceRunTimeoutMs);
      return status ? fromWireServiceStatus(status as any) : undefined;
    }
    try {
      const result = await runner.run(signal);
      return this.#recordServiceRun(name, result?.summary);
    } catch (error) {
      return fromWireServiceStatus(
        (await this.#call('services.error', {
          name,
          error: error instanceof Error ? error.message : String(error),
        })) as any,
      );
    }
  }

  async listServices(): Promise<GatewayServiceStatus[]> {
    const services = (await this.#call('services.list')) as any[];
    return services.map(fromWireServiceStatus);
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

  async leaseSandbox(spec: GatewaySandboxSpec): Promise<GatewaySandboxLease> {
    return leaseRustSandbox(this.#gatewayCall, spec);
  }
  async listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return listRustSandboxes(this.#gatewayCall);
  }
  async showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return showRustSandbox(this.#gatewayCall, id);
  }
  async releaseSandbox(id: string): Promise<GatewaySandboxLease | undefined> {
    return releaseRustSandbox(this.#gatewayCall, id);
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

  async worldSnapshot() {
    return buildGatewayWorldSnapshot(this);
  }

  async #recordServiceRun(name: string, summary?: string) {
    const status = await this.#call('services.record_run', { name, at_ms: Date.now(), summary });
    return status ? fromWireServiceStatus(status as any) : undefined;
  }

  async #call(method: string, params: unknown = {}, timeoutMs = this.#timeoutMs): Promise<unknown> {
    const id = this.#nextId++;
    const response = await request(this.#socketPath, { id, method, params }, timeoutMs);
    if (!response.ok) throw new Error(response.error ?? `Gateway IPC ${method} failed`);
    return response.result;
  }
}
