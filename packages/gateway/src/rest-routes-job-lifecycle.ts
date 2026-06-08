import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function dispatchJobLifecycle(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult | undefined> {
  if (route.method !== 'POST') return undefined;
  const [, id, action] = route.parts;
  if (id === 'acquire' && !action) return acquireJob(client, request);
  if (id && action === 'complete') return completeJob(client, id, request);
  if (id && action === 'fail') return failJob(client, id, request);
  return undefined;
}

async function acquireJob(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<{ queue?: string; worker?: string; leaseMs?: number }>(request);
  if (!body.worker) return { status: 400, body: { error: 'worker is required' } };
  const lease = await client.acquireJob(body.queue ?? 'default', body.worker, body.leaseMs);
  return { status: 200, body: lease ?? null };
}

async function completeJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ result?: unknown }>(request);
  const job = await client.completeJob(id, body.result);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}

async function failJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ error?: string; message?: string }>(request);
  const error = body.error ?? body.message;
  if (!error) return { status: 400, body: { error: 'error is required' } };
  const job = await client.failJob(id, error);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}
