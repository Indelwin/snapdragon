import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface GatewayRestServerOptions {
  hostname?: string;
  port?: number;
  pathPrefix?: string;
  streamIntervalMs?: number;
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
}

export type RestRequest = IncomingMessage;
export type RestResponse = ServerResponse;

export const MAX_GATEWAY_HTTP_REQUEST_BYTES = 1024 * 1024;
export const MAX_GATEWAY_HTTP_RESPONSE_BYTES = 1024 * 1024;

export class RestHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'RestHttpError';
  }
}

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let oversized = false;
  for await (const chunk of request) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    bytes += buffer.length;
    if (bytes > MAX_GATEWAY_HTTP_REQUEST_BYTES) {
      oversized = true;
      continue;
    }
    chunks.push(buffer);
  }
  if (oversized) {
    throw new RestHttpError(413, `request body exceeds ${MAX_GATEWAY_HTTP_REQUEST_BYTES} bytes`);
  }
  const body = Buffer.concat(chunks).toString('utf8').trim();
  try {
    return (body ? JSON.parse(body) : {}) as T;
  } catch {
    throw new RestHttpError(400, 'invalid JSON');
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  let encoded = Buffer.from(JSON.stringify(body));
  if (encoded.length > MAX_GATEWAY_HTTP_RESPONSE_BYTES) {
    status = 507;
    encoded = Buffer.from(
      JSON.stringify({
        error: `response body exceeds ${MAX_GATEWAY_HTTP_RESPONSE_BYTES} bytes; request a smaller page`,
      }),
    );
  }
  response.writeHead(status, {
    'content-length': encoded.length,
    'content-type': 'application/json',
  });
  response.end(encoded);
}

export function normalizePrefix(prefix: string): string {
  const normalized = `/${prefix.replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '' : normalized;
}
