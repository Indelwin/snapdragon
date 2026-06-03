import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayJobSpec } from './types.js';

type JobRouteHandler = (
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
) => Promise<RestRouteResult>;

const jobRouteHandlers: Record<string, JobRouteHandler> = {
  'GET  ': listJobsRoute,
  'POST  ': enqueueJobRoute,
  'GET :id ': showJobRoute,
  'DELETE :id ': cancelJobRoute,
  'POST :id cancel': cancelJobRoute,
  'POST :id retry': retryJobRoute,
};

export async function dispatchJobs(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const handler = jobRouteHandlers[jobRouteKey(route)];
  return handler ? handler(client, route, request) : notFound();
}

async function listJobsRoute(client: GatewayClient): Promise<RestRouteResult> {
  return { status: 200, body: await client.listJobs() };
}

async function showJobRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  return id && !action ? showJob(client, id) : notFound();
}

async function showJob(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const job = await client.showJob(id);
  return job ? { status: 200, body: job } : notFound('job not found');
}

async function enqueueJobRoute(
  client: GatewayClient,
  _route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ id?: string; spec?: GatewayJobSpec } & GatewayJobSpec>(request);
  return { status: 201, body: await client.enqueueJob(body.spec ?? body, body.id) };
}

async function cancelJobRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const job = await client.cancelJob(route.parts[1] ?? '');
  return job ? { status: 200, body: job } : notFound('job not found');
}

async function retryJobRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const job = await client.retryJob(route.parts[1] ?? '');
  return job ? { status: 200, body: job } : notFound('job not found');
}

function jobRouteKey(route: RestRoute): string {
  const [, id, action = ''] = route.parts;
  return `${route.method} ${id ? ':id' : ''} ${action}`;
}

function notFound(error = 'not found'): RestRouteResult {
  return { status: 404, body: { error } };
}
