import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayWorkerRegistration } from './types.js';

type WorkerRouteHandler = (
  client: GatewayClient,
  route: RestRoute,
  request?: RestRequest,
) => Promise<RestRouteResult>;

const workerRouteHandlers: Record<string, WorkerRouteHandler> = {
  'GET  ': listWorkers,
  'POST  ': registerWorkerRoute,
  'GET :id ': showWorkerRoute,
  'POST :id heartbeat': heartbeatWorkerRoute,
};

export async function dispatchWorkers(
  client: GatewayClient,
  route: RestRoute,
  request?: RestRequest,
): Promise<RestRouteResult> {
  const handler = workerRouteHandlers[workerRouteKey(route)];
  if (!handler) return notFound();
  return handler(client, route, request);
}

export async function dispatchWorkerProcesses(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (route.method !== 'GET') return notFound();
  if (route.parts[1]) return notFound();
  return { status: 200, body: (await client.status()).workerProcesses ?? [] };
}

async function listWorkers(client: GatewayClient): Promise<RestRouteResult> {
  return { status: 200, body: await client.listWorkers() };
}

async function showWorkerRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  return showWorker(client, route.parts[1] ?? '');
}

async function registerWorkerRoute(
  client: GatewayClient,
  _route: RestRoute,
  request?: RestRequest,
): Promise<RestRouteResult> {
  if (!request) return { status: 400, body: { error: 'missing worker registration' } };
  return registerWorker(client, request);
}

async function heartbeatWorkerRoute(
  client: GatewayClient,
  route: RestRoute,
  request?: RestRequest,
): Promise<RestRouteResult> {
  return heartbeatWorker(client, route.parts[1] ?? '', request);
}

async function showWorker(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const worker = await client.showWorker(id);
  return worker
    ? { status: 200, body: worker }
    : { status: 404, body: { error: 'worker not found' } };
}

function workerRouteKey(route: RestRoute): string {
  const [, id, action = ''] = route.parts;
  return `${route.method} ${id ? ':id' : ''} ${action}`;
}

function notFound(): RestRouteResult {
  return { status: 404, body: { error: 'not found' } };
}

async function registerWorker(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ worker?: GatewayWorkerRegistration } & GatewayWorkerRegistration>(
    request,
  );
  if (!body || typeof body !== 'object') {
    return { status: 400, body: { error: 'missing worker registration' } };
  }
  return { status: 201, body: await client.registerWorker(body.worker ?? body) };
}

async function heartbeatWorker(
  client: GatewayClient,
  id: string,
  request?: RestRequest,
): Promise<RestRouteResult> {
  const body = request ? await readJson<Record<string, unknown>>(request) : {};
  const worker = await client.heartbeatWorker({ id, ...body });
  return worker
    ? { status: 200, body: worker }
    : { status: 404, body: { error: 'worker not found' } };
}
