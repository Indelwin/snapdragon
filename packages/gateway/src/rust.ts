import { request } from './rust-ipc.js';
import type { RustGatewayClientOptions } from './rust-options.js';
import {
  fromWireActor,
  fromWireEnvelope,
  fromWireRegistrySnapshot,
  fromWireTableSnapshot,
  toWireActor,
  toWireEnvelope,
  toWireFilter,
  toWireServiceSpec,
  toWireTableAccess,
} from './rust-wire.js';
import {
  fromWireEventRecord,
  fromWireJobLease,
  fromWireJobStatus,
  fromWireLogRecord,
  toWireJobSpec,
  toWireLogInput,
} from './rust-wire-durable.js';
import {
  fromWireAgentRuntimeDescriptor,
  toWireAgentRuntimeDescriptor,
} from './rust-wire-runtime.js';
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

  constructor(options: RustGatewayClientOptions) {
    this.#socketPath = options.socketPath;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
    this.#serviceRunTimeoutMs = options.serviceRunTimeoutMs ?? 300_000;
  }

  async send(envelope: GatewayEnvelope): Promise<void> {
    await this.#call('envelope.send', { envelope: toWireEnvelope(envelope) });
  }

  async receive(
    actor: ActorId,
    filter: GatewayReceiveFilter = {},
  ): Promise<GatewayEnvelope | undefined> {
    return fromWireEnvelope(
      await this.#call('envelope.receive', {
        actor: toWireActor(actor),
        filter: toWireFilter(filter),
      }),
    );
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
    await this.#call('registry.register_capability', { capability, actor: toWireActor(actor) });
  }

  async whereisCapability(capability: string): Promise<ActorId[]> {
    const actors = (await this.#call('registry.whereis_capability', { capability })) as unknown[];
    return actors.map(fromWireActor);
  }

  async registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return fromWireRegistrySnapshot(await this.#call('registry.list'));
  }

  async registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    const runtime = fromWireAgentRuntimeDescriptor(
      (await this.#call('agents.register', {
        descriptor: toWireAgentRuntimeDescriptor(descriptor),
      })) as any,
    );
    if (!runtime) throw new Error('Gateway returned no runtime for agents.register');
    return runtime;
  }

  async listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]> {
    return ((await this.#call('agents.list')) as unknown[])
      .map((runtime) => fromWireAgentRuntimeDescriptor(runtime as any))
      .filter((runtime): runtime is GatewayAgentRuntimeDescriptor => runtime !== undefined);
  }

  async showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return fromWireAgentRuntimeDescriptor((await this.#call('agents.show', { id })) as any);
  }

  async createTable(
    name: string,
    owner: ActorId,
    access: GatewayTableAccess = 'protected',
  ): Promise<boolean> {
    return Boolean(
      await this.#call('tables.create', {
        name,
        owner: toWireActor(owner),
        access: toWireTableAccess(access),
      }),
    );
  }

  async tableNames(): Promise<string[]> {
    return ((await this.#call('tables.list')) as string[]).sort();
  }

  async tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined> {
    return fromWireTableSnapshot((await this.#call('tables.show', { name })) as any);
  }

  async enqueueJob(spec: GatewayJobSpec, id?: string): Promise<GatewayJobStatus> {
    const job = fromWireJobStatus(
      (await this.#call('jobs.enqueue', { id, spec: toWireJobSpec(spec) })) as any,
    );
    if (!job) throw new Error('Gateway returned no job for jobs.enqueue');
    return job;
  }

  async listJobs(): Promise<GatewayJobStatus[]> {
    return ((await this.#call('jobs.list')) as unknown[])
      .map((job) => fromWireJobStatus(job as any))
      .filter((job): job is GatewayJobStatus => job !== undefined);
  }

  async showJob(id: string): Promise<GatewayJobStatus | undefined> {
    return fromWireJobStatus((await this.#call('jobs.show', { id })) as any);
  }

  async cancelJob(id: string): Promise<GatewayJobStatus | undefined> {
    return fromWireJobStatus((await this.#call('jobs.cancel', { id })) as any);
  }

  async acquireJob(
    queue: string,
    worker: string,
    leaseMs = 300_000,
  ): Promise<GatewayJobLease | undefined> {
    return fromWireJobLease(
      (await this.#call('jobs.acquire', { queue, worker, lease_ms: leaseMs })) as any,
    );
  }

  async completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined> {
    return fromWireJobStatus((await this.#call('jobs.complete', { id, result })) as any);
  }

  async failJob(id: string, error: string): Promise<GatewayJobStatus | undefined> {
    return fromWireJobStatus((await this.#call('jobs.fail', { id, error })) as any);
  }

  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord> {
    const event = fromWireEventRecord((await this.#call('events.append', input)) as any);
    if (!event) throw new Error('Gateway returned no event for events.append');
    return event;
  }

  async listEvents(): Promise<GatewayEventRecord[]> {
    return ((await this.#call('events.list')) as unknown[])
      .map((event) => fromWireEventRecord(event as any))
      .filter((event): event is GatewayEventRecord => event !== undefined);
  }

  async cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return fromWireEventRecord((await this.#call('events.cancel', { id })) as any);
  }

  async appendLog(input: GatewayLogInput): Promise<GatewayLogRecord> {
    return fromWireLogRecord(await this.#call('logs.append', toWireLogInput(input)));
  }

  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    return ((await this.#call('logs.tail', options)) as any[]).map(fromWireLogRecord);
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
