import { readRestJson } from './rest-client-response.js';
import { readGatewaySnapshotStream } from './rest-client-sse.js';
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
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLogRecord,
  GatewayRegistrySnapshot,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';

type QueryValue = number | string | undefined;

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  search?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

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

  worldSnapshot(): Promise<GatewayWorldSnapshot> {
    return this.#get('world');
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

  listWorkers(): Promise<GatewayWorkerRecord[]> {
    return this.#get('workers');
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

  listJobs(): Promise<GatewayJobStatus[]> {
    return this.#get('jobs');
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

  listEvents(): Promise<GatewayEventRecord[]> {
    return this.#get('events');
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

  registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return this.#get('registry');
  }

  capabilities(): Promise<Record<string, ActorId[]>> {
    return this.#get('capabilities');
  }

  listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return this.#get('sandboxes');
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
    const response = await this.#request('stream', {
      headers: { accept: 'text/event-stream' },
      signal: options.signal,
    });
    yield* readGatewaySnapshotStream(response);
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
    const response = await this.#request(path, options);
    if (response.status === 404) {
      await response.text();
      return undefined;
    }
    return readRestJson<T>(response);
  }

  #request(path: string, options: RequestOptions = {}): Promise<Response> {
    return this.#fetch(this.#url(path, options.search), {
      body: requestBody(options.body),
      headers: requestHeaders(this.#headers, options),
      method: options.method ?? 'GET',
      signal: options.signal,
    });
  }

  #url(path: string, search: Record<string, QueryValue> = {}): URL {
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
    for (const [key, value] of Object.entries(search)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function requestBody(body: unknown): string | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

function requestHeaders(
  baseHeaders: Record<string, string>,
  options: RequestOptions,
): Record<string, string> {
  const contentHeaders: Record<string, string> = {};
  if (options.body !== undefined) contentHeaders['content-type'] = 'application/json';
  return { ...baseHeaders, ...contentHeaders, ...(options.headers ?? {}) };
}
