import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { GatewayRuntime } from './types-core.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';

export interface GatewayRestServerOptions {
  hostname?: string;
  port?: number;
  pathPrefix?: string;
  streamIntervalMs?: number;
  streamHeartbeatMs?: number;
}

export interface GatewayRestServer {
  readonly server: Server;
  listen(options?: Pick<GatewayRestServerOptions, 'hostname' | 'port'>): Promise<string>;
  close(): Promise<void>;
}

export interface RestRoute {
  method: string;
  parts: string[];
  searchParams: URLSearchParams;
}

export interface RestRouteResult {
  status: number;
  body: unknown;
}

export interface RestRequestContext {
  pathPrefix: string;
  streamIntervalMs: number;
  streamHeartbeatMs: number;
}

export type RestRequest = IncomingMessage;
export type RestResponse = ServerResponse;

export interface GatewayRestStreamSnapshotEvent {
  id: number;
  type: 'snapshot';
  atMs: number;
  snapshot: GatewayWorldSnapshot;
}

export interface GatewayRestStreamHeartbeatEvent {
  id: number;
  type: 'heartbeat';
  atMs: number;
  runtime: GatewayRuntime;
}

export interface GatewayRestStreamErrorEvent {
  id: number;
  type: 'error';
  atMs: number;
  error: string;
}

export type GatewayRestStreamEvent =
  | GatewayRestStreamSnapshotEvent
  | GatewayRestStreamHeartbeatEvent
  | GatewayRestStreamErrorEvent;

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  return (body ? JSON.parse(body) : {}) as T;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function normalizePrefix(prefix: string): string {
  const normalized = `/${prefix.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
}
