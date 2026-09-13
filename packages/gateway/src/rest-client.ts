import { readAllRestPages } from './rest-client-pages.js';
import {
  normalizeBaseUrl,
  type QueryValue,
  type RequestOptions,
  requestBody,
  requestHeaders,
  restUrl,
  worldSearch,
} from './rest-client-request.js';
import { readRestJson, readRestJsonOptional } from './rest-client-response.js';
import { streamGatewayWorldSnapshots } from './rest-client-stream.js';
import type {
  GatewayRestClientOptions,
  GatewayRestHealth,
  GatewayRestStreamOptions,
} from './rest-client-types.js';
import type {
  ActorId,
  GatewayAgentRuntimeDescriptor,
  GatewayClient,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLeaseFence,
  GatewayLogInput,
  GatewayLogRecord,
  GatewayRegistrySnapshot,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';
import type { GatewayWorldSnapshot, GatewayWorldSnapshotOptions } from './types-runtime.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';

export class GatewayRestClient {
  readonly baseUrl: string;
  #fetch: typeof fetch;
  #headers: Record<string, string>;

  constructor(options: GatewayRestClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#headers = options.headers ?? {};
  }

  health(): Promise<GatewayRestHealth> {
    return this.#get('health');
  }

  status(): Promise<GatewayStatus> {
    return this.#get('status');
  }

  worldSnapshot(options: GatewayWorldSnapshotOptions = {}): Promise<GatewayWorldSnapshot> {
    return this.#get('world', { search: worldSearch(options) });
  }

  listServices(): Promise<GatewayServiceStatus[]> {
    return this.#get('services');
  }

  registerService(spec: GatewayServiceSpec): Promise<GatewayServiceSpec> {
    return this.#post('services', { spec });
  }

  runService(name: string): Promise<GatewayServiceStatus | undefined> {
    return this.#post(`services/${encodeURIComponent(name)}/run`, {});
  }

  enableService(name: string, enabled: boolean): Promise<GatewayServiceStatus[]> {
    return this.#post(`services/${encodeURIComponent(name)}/enable`, { enabled });
  }

  listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]> {
    return this.#get('agents');
  }

  registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    return this.#post('agents/register', { descriptor });
  }

  showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return this.#getOptional(`agents/${encodeURIComponent(id)}`);
  }

  listWorkers(options: GatewayWorldSnapshotOptions = {}): Promise<GatewayWorkerRecord[]> {
    return this.#getAllPages('workers', worldSearch(options));
  }

  registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord> {
    return this.#post('workers/register', worker);
  }

  heartbeatWorker(heartbeat: GatewayWorkerHeartbeat): Promise<GatewayWorkerRecord | undefined> {
    return this.#postOptional(`workers/${encodeURIComponent(heartbeat.id)}/heartbeat`, heartbeat);
  }

  showWorker(id: string): Promise<GatewayWorkerRecord | undefined> {
    return this.#getOptional(`workers/${encodeURIComponent(id)}`);
  }

  listJobs(options: GatewayWorldSnapshotOptions = {}): Promise<GatewayJobStatus[]> {
    return this.#getAllPages('jobs', worldSearch(options));
  }

  enqueueJob(spec: GatewayJobSpec, id?: string): Promise<GatewayJobStatus> {
    return this.#post('jobs', { id, spec });
  }

  showJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#getOptional(`jobs/${encodeURIComponent(id)}`);
  }

  cancelJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#post(`jobs/${encodeURIComponent(id)}/cancel`, {});
  }

  retryJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#post(`jobs/${encodeURIComponent(id)}/retry`, {});
  }

  async acquireJob(
    queue: string,
    worker: string,
    leaseMs?: number,
  ): Promise<GatewayJobLease | undefined> {
    const lease = await this.#post<GatewayJobLease | null>('jobs/acquire', {
      queue,
      worker,
      leaseMs,
    });
    return lease ?? undefined;
  }

  renewJob(
    id: string,
    fence: GatewayLeaseFence,
    leaseMs?: number,
  ): Promise<GatewayJobLease | undefined> {
    return this.#postOptional(`jobs/${encodeURIComponent(id)}/renew`, { ...fence, leaseMs });
  }

  completeJob(
    id: string,
    result: unknown,
    fence: GatewayLeaseFence,
  ): Promise<GatewayJobStatus | undefined> {
    return this.#postOptional(`jobs/${encodeURIComponent(id)}/complete`, { result, ...fence });
  }

  failJob(
    id: string,
    error: string,
    fence: GatewayLeaseFence,
  ): Promise<GatewayJobStatus | undefined> {
    return this.#postOptional(`jobs/${encodeURIComponent(id)}/fail`, { error, ...fence });
  }

  listEvents(options: GatewayWorldSnapshotOptions = {}): Promise<GatewayEventRecord[]> {
    return this.#getAllPages('events', worldSearch(options));
  }

  appendEvent(input: Parameters<GatewayClient['appendEvent']>[0]): Promise<GatewayEventRecord> {
    return this.#post('events', input);
  }

  cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return this.#postOptional(`events/${encodeURIComponent(id)}/cancel`, {});
  }

  tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    return this.#get('logs', { search: options });
  }

  appendLog(input: GatewayLogInput): Promise<GatewayLogRecord> {
    return this.#post('logs', input);
  }

  registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return this.#get('registry');
  }

  capabilities(): Promise<Record<string, ActorId[]>> {
    return this.#get('capabilities');
  }

  listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return this.#getAllPages('sandboxes');
  }

  registerSandboxLease(lease: GatewaySandboxLease): Promise<GatewaySandboxLease> {
    return this.#post('sandboxes/register', { lease });
  }

  showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#getOptional(`sandboxes/${encodeURIComponent(id)}`);
  }

  releaseSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#postOptional(`sandboxes/${encodeURIComponent(id)}/release`, {});
  }

  async *streamWorldSnapshots(
    options: GatewayRestStreamOptions = {},
  ): AsyncIterable<GatewayWorldSnapshot> {
    yield* streamGatewayWorldSnapshots((path, request) => this.#request(path, request), options);
  }

  #get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.#json(path, { ...options, method: 'GET' });
  }

  #post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.#json(path, { ...options, body, method: 'POST' });
  }

  #getOptional<T>(path: string, options: RequestOptions = {}): Promise<T | undefined> {
    return this.#jsonOptional(path, { ...options, method: 'GET' });
  }

  #postOptional<T>(
    path: string,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T | undefined> {
    return this.#jsonOptional(path, { ...options, body, method: 'POST' });
  }

  async #json<T>(path: string, options: RequestOptions): Promise<T> {
    return readRestJson<T>(await this.#request(path, options));
  }

  async #jsonOptional<T>(path: string, options: RequestOptions): Promise<T | undefined> {
    return readRestJsonOptional<T>(await this.#request(path, options));
  }

  #getAllPages<T>(path: string, search: Record<string, QueryValue> = {}): Promise<T[]> {
    return readAllRestPages<T>((pagePath, options) => this.#get(pagePath, options), path, search);
  }

  #request(path: string, options: RequestOptions = {}): Promise<Response> {
    return this.#fetch(restUrl(this.baseUrl, path, options.search), {
      body: requestBody(options.body),
      headers: requestHeaders(this.#headers, options),
      method: options.method ?? 'GET',
      signal: options.signal,
    });
  }
}
