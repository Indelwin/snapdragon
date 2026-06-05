import type { PiRpcRuntimeOptions } from './pi-rpc.js';
import {
  type GatewayRestClientOptions,
  type GatewayRestClientStreamOptions,
  RestClientHttp,
  segment,
  unsupported,
} from './rest-client-http.js';
import { worldSnapshotOptionsToSearchParams } from './rest-query-build.js';
import type { GatewayRestStreamEvent } from './rest-types.js';
import type {
  ActorId,
  GatewayAgentRuntimeDescriptor,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLogInput,
  GatewayLogRecord,
  GatewayRegistrySnapshot,
  GatewaySandboxLease,
  GatewaySandboxSpec,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableSnapshot,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';
import type { GatewayWorldSnapshot, GatewayWorldSnapshotOptions } from './types-runtime.js';

export { GatewayRestClientError } from './rest-client-http.js';
export type { GatewayRestClientOptions, GatewayRestClientStreamOptions };

export class GatewayRestClient {
  readonly runtime = 'rest' as const;
  readonly baseUrl: string;
  #http: RestClientHttp;

  constructor(options: GatewayRestClientOptions | string | URL) {
    this.#http = new RestClientHttp(options);
    this.baseUrl = this.#http.baseUrl;
  }

  async status(): Promise<GatewayStatus> {
    return this.#http.request('GET', 'status');
  }

  async worldSnapshot(options?: GatewayWorldSnapshotOptions): Promise<GatewayWorldSnapshot> {
    return this.#http.request('GET', 'world', undefined, query(options));
  }

  async registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    if (runner) unsupported('registerService with local runners');
    await this.#http.request<GatewayServiceSpec>('POST', 'services', { spec });
  }

  async enableService(name: string, enabled: boolean): Promise<void> {
    await this.#http.request<GatewayServiceStatus[]>('POST', `services/${segment(name)}/enable`, {
      enabled,
    });
  }

  async runService(name: string): Promise<GatewayServiceStatus | undefined> {
    return this.#http.request('POST', `services/${segment(name)}/run`, {});
  }

  async listServices(options?: GatewayWorldSnapshotOptions): Promise<GatewayServiceStatus[]> {
    return this.#http.request('GET', 'services', undefined, query(options));
  }

  async registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    return this.#http.request('POST', 'agents/register', { descriptor });
  }

  async listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]> {
    return this.#http.request('GET', 'agents');
  }

  async showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return this.#http.maybe('GET', `agents/${segment(id)}`);
  }

  async unregisterAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return this.#http.maybe('DELETE', `agents/${segment(id)}`);
  }

  async probeAgentRuntime(
    kind: GatewayAgentRuntimeDescriptor['kind'],
    options?: Record<string, unknown>,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    return this.#http.request('POST', 'agents/probe', { kind, options });
  }

  async probePiAgentRuntime(options?: PiRpcRuntimeOptions): Promise<GatewayAgentRuntimeDescriptor> {
    return this.#http.request('POST', 'agents/probe/pi', { options });
  }

  async registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord> {
    return this.#http.request('POST', 'workers', worker);
  }

  async heartbeatWorker(
    heartbeat: GatewayWorkerHeartbeat,
  ): Promise<GatewayWorkerRecord | undefined> {
    return this.#http.maybe('POST', `workers/${segment(heartbeat.id)}/heartbeat`, heartbeat);
  }

  async listWorkers(options?: GatewayWorldSnapshotOptions): Promise<GatewayWorkerRecord[]> {
    return this.#http.request('GET', 'workers', undefined, query(options));
  }

  async showWorker(id: string): Promise<GatewayWorkerRecord | undefined> {
    return this.#http.maybe('GET', `workers/${segment(id)}`);
  }

  async unregisterWorker(id: string): Promise<GatewayWorkerRecord | undefined> {
    return this.#http.maybe('DELETE', `workers/${segment(id)}`);
  }

  async whereisCapability(capability: string): Promise<ActorId[]> {
    const capabilities = await this.#http.request<GatewayRegistrySnapshot['capabilities']>(
      'GET',
      'capabilities',
    );
    return capabilities[capability] ?? [];
  }

  async registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return this.#http.request('GET', 'registry');
  }

  async tableNames(): Promise<string[]> {
    return (await this.status()).tables;
  }

  async tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined> {
    const snapshot = await this.worldSnapshot({ sections: ['tables'], tables: [name] });
    return snapshot.tables.find((table) => table.name === name);
  }

  async enqueueJob(spec: GatewayJobSpec, id?: string): Promise<GatewayJobStatus> {
    return this.#http.request('POST', 'jobs', { id, spec });
  }

  async listJobs(options?: GatewayWorldSnapshotOptions): Promise<GatewayJobStatus[]> {
    return this.#http.request('GET', 'jobs', undefined, query(options));
  }

  async showJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#http.maybe('GET', `jobs/${segment(id)}`);
  }

  async cancelJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#http.maybe('DELETE', `jobs/${segment(id)}`);
  }

  async retryJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#http.maybe('POST', `jobs/${segment(id)}/retry`, {});
  }

  async acquireJob(
    queue: string,
    worker: string,
    leaseMs?: number,
  ): Promise<GatewayJobLease | undefined> {
    const lease = await this.#http.request<GatewayJobLease | null>('POST', 'jobs/acquire', {
      leaseMs,
      queue,
      worker,
    });
    return lease ?? undefined;
  }

  async completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined> {
    return this.#http.maybe('POST', `jobs/${segment(id)}/complete`, { result });
  }

  async failJob(id: string, error: string): Promise<GatewayJobStatus | undefined> {
    return this.#http.maybe('POST', `jobs/${segment(id)}/fail`, { error });
  }

  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord> {
    return this.#http.request('POST', 'events', input);
  }

  async listEvents(options?: GatewayWorldSnapshotOptions): Promise<GatewayEventRecord[]> {
    return this.#http.request('GET', 'events', undefined, query(options));
  }

  async cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return this.#http.maybe('DELETE', `events/${segment(id)}`);
  }

  async appendLog(input: GatewayLogInput): Promise<GatewayLogRecord> {
    return this.#http.request('POST', 'logs', input);
  }

  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    const searchParams = new URLSearchParams();
    if (options.target) searchParams.set('target', options.target);
    if (options.limit !== undefined) searchParams.set('limit', String(options.limit));
    return this.#http.request('GET', 'logs', undefined, searchParams);
  }

  async *stream(
    options: GatewayRestClientStreamOptions = {},
  ): AsyncGenerator<GatewayRestStreamEvent> {
    yield* this.#http.stream(options);
  }

  async leaseSandbox(spec: GatewaySandboxSpec): Promise<GatewaySandboxLease> {
    return this.#http.request('POST', 'sandboxes', spec);
  }

  async listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return this.#http.request('GET', 'sandboxes');
  }

  async showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#http.maybe('GET', `sandboxes/${segment(id)}`);
  }

  async releaseSandbox(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#http.maybe('POST', `sandboxes/${segment(id)}/release`, {});
  }
}

export function createGatewayRestClient(
  options: GatewayRestClientOptions | string | URL,
): GatewayRestClient {
  return new GatewayRestClient(options);
}

function query(options?: GatewayWorldSnapshotOptions): URLSearchParams {
  return worldSnapshotOptionsToSearchParams(options);
}
