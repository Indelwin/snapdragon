import { createConnection } from 'node:net';
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
} from './rust-wire-durable.js';
import { fromWireServiceStatus, fromWireStatus } from './rust-wire-status.js';
import type {
  ActorId,
  GatewayClient,
  GatewayEnvelope,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
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

export interface RustGatewayClientOptions {
  socketPath: string;
  timeoutMs?: number;
  serviceRunTimeoutMs?: number;
}

interface IpcResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class RustGatewayClient implements GatewayClient {
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

  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    return ((await this.#call('logs.tail', options)) as any[]).map(fromWireLogRecord);
  }

  async #recordServiceRun(
    name: string,
    summary?: string,
  ): Promise<GatewayServiceStatus | undefined> {
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

function request(socketPath: string, payload: unknown, timeoutMs: number): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ path: socketPath });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Gateway IPC timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    let buffer = '';
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lineEnd = buffer.indexOf('\n');
      if (lineEnd < 0) return;
      clearTimeout(timer);
      socket.end();
      resolve(JSON.parse(buffer.slice(0, lineEnd)) as IpcResponse);
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
