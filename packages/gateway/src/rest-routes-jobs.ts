import { mutateJob } from './rest-routes-job-mutations.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayJobSpec } from './types.js';

export async function dispatchJobs(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET' && !id) return { status: 200, body: await client.listJobs() };
  if (route.method === 'GET' && id) return showJob(client, id);
  if (route.method === 'POST') {
    return mutateJob(client, id, action, request, () => enqueueJob(client, request));
  }
  return { status: 404, body: { error: 'not found' } };
}

async function showJob(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const job = await client.showJob(id);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}

async function enqueueJob(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<{ id?: string; spec?: GatewayJobSpec } & GatewayJobSpec>(request);
  return { status: 201, body: await client.enqueueJob(body.spec ?? body, body.id) };
}
