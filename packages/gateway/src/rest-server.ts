import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dispatchRoute } from './rest-routes.js';
import { sendStream } from './rest-stream.js';
import {
  type GatewayRestServer,
  type GatewayRestServerOptions,
  normalizePrefix,
  RestHttpError,
  type RestRequest,
  type RestRequestContext,
  type RestResponse,
  type RestRoute,
  sendJson,
} from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

export function createGatewayRestServer(
  client: GatewayOrchestrationClient,
  options: GatewayRestServerOptions = {},
): GatewayRestServer {
  const context = {
    pathPrefix: normalizePrefix(options.pathPrefix ?? '/v1'),
    streamIntervalMs: options.streamIntervalMs ?? 1_000,
  };
  const server = createServer((request, response) => {
    handleRequest(client, request, response, context).catch((error) => {
      sendRestError(response, error);
    });
  });
  return {
    server,
    listen(listenOptions = {}) {
      return listen(server, context.pathPrefix, {
        hostname: listenOptions.hostname ?? options.hostname ?? '127.0.0.1',
        port: listenOptions.port ?? options.port ?? 0,
      });
    },
    close() {
      return close(server);
    },
  };
}

async function handleRequest(
  client: GatewayOrchestrationClient,
  request: RestRequest,
  response: RestResponse,
  context: RestRequestContext,
): Promise<void> {
  const route = routeFor(request, context.pathPrefix);
  if (!route) {
    sendJson(response, 404, { error: 'not found' });
    return;
  }
  if (route.method === 'GET' && route.parts[0] === 'stream') {
    await sendStream(client, response, context.streamIntervalMs, route.searchParams);
    return;
  }
  const result = await dispatchRoute(client, route, request);
  sendJson(response, result.status, result.body);
}

function listen(
  server: GatewayRestServer['server'],
  pathPrefix: string,
  options: Required<Pick<GatewayRestServerOptions, 'hostname' | 'port'>>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.hostname, () => {
      server.off('error', reject);
      const address = server.address() as AddressInfo;
      resolve(`http://${address.address}:${address.port}${pathPrefix}`);
    });
  });
}

function close(server: GatewayRestServer['server']): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function routeFor(request: RestRequest, pathPrefix: string): RestRoute | undefined {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (!matchesPathPrefix(url.pathname, pathPrefix)) return undefined;
  const path = url.pathname.slice(pathPrefix.length).replace(/^\/+/, '');
  return {
    method: request.method ?? 'GET',
    parts: path ? path.split('/').map(decodeURIComponent) : [],
    searchParams: url.searchParams,
  };
}

function matchesPathPrefix(pathname: string, pathPrefix: string): boolean {
  if (!pathPrefix) return true;
  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
}

function sendRestError(response: RestResponse, error: unknown): void {
  const status = error instanceof RestHttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : String(error);
  sendJson(response, status, { error: message });
}
