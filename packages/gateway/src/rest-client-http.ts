import {
  appendNumberParam,
  type GatewayRestClientOptions,
  normalizeRestBaseUrl,
  normalizeRestClientOptions,
  type RestHeaders,
  resolveRestHeaders,
} from './rest-client-config.js';
import { parseRestStream } from './rest-client-stream.js';
import { worldSnapshotOptionsToSearchParams } from './rest-query-build.js';
import type { GatewayRestStreamEvent } from './rest-types.js';
import type { GatewayWorldSnapshotOptions } from './types-runtime.js';

export type { GatewayRestClientOptions } from './rest-client-config.js';

export interface GatewayRestClientStreamOptions {
  snapshotOptions?: GatewayWorldSnapshotOptions;
  intervalMs?: number;
  heartbeatMs?: number;
  signal?: AbortSignal;
}

export class RestClientHttp {
  readonly baseUrl: string;
  #fetch: typeof fetch;
  #headers?: RestHeaders;

  constructor(options: GatewayRestClientOptions | string | URL) {
    const normalized = normalizeRestClientOptions(options);
    const baseUrl = normalizeRestBaseUrl(normalized.baseUrl);
    this.baseUrl = baseUrl.href.replace(/\/$/, '');
    this.#fetch = normalized.fetch ?? fetch;
    this.#headers = normalized.headers;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    searchParams?: URLSearchParams,
  ): Promise<T> {
    const value = await this.send<T>(method, path, body, searchParams, false);
    return value as T;
  }

  async maybe<T>(
    method: string,
    path: string,
    body?: unknown,
    searchParams?: URLSearchParams,
  ): Promise<T | undefined> {
    return this.send<T>(method, path, body, searchParams, true);
  }

  async *stream(
    options: GatewayRestClientStreamOptions = {},
  ): AsyncGenerator<GatewayRestStreamEvent> {
    const searchParams = worldSnapshotOptionsToSearchParams(options.snapshotOptions);
    appendNumberParam(searchParams, 'intervalMs', options.intervalMs);
    appendNumberParam(searchParams, 'heartbeatMs', options.heartbeatMs);
    const response = await this.#fetch(this.url('stream', searchParams), {
      headers: await this.requestHeaders(false),
      signal: options.signal,
    });
    if (!response.ok) throw await restError(response);
    if (!response.body) throw new Error('gateway REST stream response has no body');
    yield* parseRestStream(response.body);
  }

  async send<T>(
    method: string,
    path: string,
    body: unknown,
    searchParams: URLSearchParams | undefined,
    allowNotFound: boolean,
  ): Promise<T | undefined> {
    const response = await this.#fetch(this.url(path, searchParams), {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: await this.requestHeaders(body !== undefined),
      method,
    });
    if (allowNotFound && response.status === 404) return undefined;
    if (!response.ok) throw await restError(response);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T | undefined;
  }

  async requestHeaders(hasJsonBody: boolean): Promise<Headers> {
    const headers = new Headers(await resolveRestHeaders(this.#headers));
    if (hasJsonBody && !headers.has('content-type'))
      headers.set('content-type', 'application/json');
    return headers;
  }

  url(path: string, searchParams?: URLSearchParams): string {
    const url = new URL(path.replace(/^\/+/, ''), `${this.baseUrl}/`);
    searchParams?.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    return url.href;
  }
}

export class GatewayRestClientError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(errorMessage(status, detail));
    this.name = 'GatewayRestClientError';
  }
}

export function segment(value: string): string {
  return encodeURIComponent(value);
}

export function unsupported(method: string): never {
  throw new Error(
    `Gateway REST client does not expose ${method}; use the Rust or inline client for local-only runtime internals.`,
  );
}

async function restError(response: Response): Promise<GatewayRestClientError> {
  return new GatewayRestClientError(response.status, await response.text());
}

function errorMessage(status: number, detail: string): string {
  if (detail) return `gateway REST request failed (${status}): ${detail}`;
  return `gateway REST request failed (${status})`;
}
