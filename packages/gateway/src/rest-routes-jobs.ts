import { filterJobs } from './query-filters.js';
import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import { dispatchJobLifecycle } from './rest-routes-job-lifecycle.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayJobSpec } from './types.js';

export async function dispatchJobs(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  if (route.method === 'GET') return readJobRoute(client, route);
  if (route.method === 'POST') return writeJobRoute(client, route, request);
  return notFound();
}

async function readJobRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (!id) return listJobs(client, route);
  if (!action) return showJob(client, id);
  return notFound();
}

async function writeJobRoute(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (!id) return enqueueJob(client, request);
  const lifecycle = await dispatchJobLifecycle(client, route, request);
  if (lifecycle) return lifecycle;
  if (action === 'cancel') return { status: 200, body: await client.cancelJob(id) };
  if (action === 'retry') return { status: 200, body: await client.retryJob(id) };
  return notFound();
}

async function listJobs(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const options = worldSnapshotOptionsFromSearch(route.searchParams);
  return { status: 200, body: filterJobs(await client.listJobs(), options) };
}

async function showJob(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const job = await client.showJob(id);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}

async function enqueueJob(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<{ id?: string; spec?: GatewayJobSpec } & GatewayJobSpec>(request);
  return { status: 201, body: await client.enqueueJob(body.spec ?? body, body.id) };
}

function notFound(): RestRouteResult {
  return { status: 404, body: { error: 'not found' } };
}
