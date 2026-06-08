import type { GatewayWorldSnapshotOptions } from './types-runtime.js';

export type QueryValue = boolean | number | string | readonly string[] | undefined;

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  method?: string;
  search?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function requestBody(body: unknown): string | undefined {
  return body === undefined ? undefined : JSON.stringify(body);
}

export function requestHeaders(
  baseHeaders: Record<string, string>,
  options: RequestOptions,
): Record<string, string> {
  const contentHeaders: Record<string, string> = {};
  if (options.body !== undefined) contentHeaders['content-type'] = 'application/json';
  return { ...baseHeaders, ...contentHeaders, ...(options.headers ?? {}) };
}

export function restUrl(
  baseUrl: string,
  path: string,
  search: Record<string, QueryValue> = {},
): URL {
  const url = new URL(path.replace(/^\/+/, ''), baseUrl);
  for (const [key, value] of Object.entries(search)) {
    if (Array.isArray(value)) url.searchParams.set(key, value.join(','));
    else if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

export function worldSearch(options: GatewayWorldSnapshotOptions): Record<string, QueryValue> {
  return {
    sections: options.sections,
    target: options.target,
    queue: options.queue,
    runtimeId: options.runtimeId,
    service: options.service,
    worker: options.worker,
    workerState: options.workerState,
    capability: options.capability,
    serviceState: options.serviceState,
    enabled: options.serviceEnabled,
    jobKind: options.jobKind,
    jobState: options.jobState,
    eventKind: options.eventKind,
    eventState: options.eventState,
    logLimit: options.logLimit,
    tables: options.tables,
  };
}
