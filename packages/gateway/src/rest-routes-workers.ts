import { filterWorkers } from './query-filters.js';
import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayWorkerHeartbeat, GatewayWorkerRegistration } from './types.js';

export async function dispatchWorkers(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET' && !id) {
    return {
      status: 200,
      body: filterWorkers(
        await client.listWorkers(),
        worldSnapshotOptionsFromSearch(route.searchParams),
      ),
    };
  }
  if (route.method === 'GET' && id) return showWorker(client, id);
  if (route.method === 'POST' && id === 'register' && !action) {
    return registerWorker(client, request);
  }
  if (route.method === 'POST' && id && action === 'heartbeat') {
    return heartbeatWorker(client, id, request);
  }
  return { status: 404, body: { error: 'not found' } };
}

async function showWorker(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const worker = await client.showWorker(id);
  return worker
    ? { status: 200, body: worker }
    : { status: 404, body: { error: 'worker not found' } };
}

async function registerWorker(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ worker?: GatewayWorkerRegistration } & GatewayWorkerRegistration>(
    request,
  );
  const worker = await client.registerWorker(body.worker ?? body);
  return { status: 201, body: worker };
}

async function heartbeatWorker(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<Omit<GatewayWorkerHeartbeat, 'id'> & { id?: string }>(request);
  const worker = await client.heartbeatWorker({ ...body, id });
  return worker
    ? { status: 200, body: worker }
    : { status: 404, body: { error: 'worker not found' } };
}
