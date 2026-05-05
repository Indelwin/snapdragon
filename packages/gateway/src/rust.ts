import { createConnection } from 'node:net';
import {
  fromWireActor,
  fromWireEnvelope,
  fromWireRegistrySnapshot,
  fromWireServiceStatus,
  fromWireStatus,
  fromWireTableSnapshot,
  toWireActor,
  toWireEnvelope,
  toWireFilter,
  toWireServiceSpec,
  toWireTableAccess,
} from './rust-wire.js';
import type {
  ActorId,
  GatewayClient,
  GatewayEnvelope,
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
