import { type RestRequest, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

interface AcquireJobBody {
  queue?: string;
  worker?: string;
  leaseMs?: number;
}

export async function mutateJob(
  client: GatewayClient,
  id: string | undefined,
  action: string | undefined,
  request: RestRequest,
  enqueue: () => Promise<RestRouteResult>,
): Promise<RestRouteResult> {
  if (!id) return enqueue();
  if (id === 'acquire' && !action) return acquireJob(client, request);
  if (action === 'cancel') return updateJob(await client.cancelJob(id));
  if (action === 'complete') return completeJob(client, id, request);
  if (action === 'fail') return failJob(client, id, request);
  return { status: 404, body: { error: 'not found' } };
}

async function acquireJob(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<AcquireJobBody>(request);
  if (!body.worker) return { status: 400, body: { error: 'missing worker' } };
  const lease = await client.acquireJob(body.queue ?? 'default', body.worker, body.leaseMs);
  return { status: 200, body: lease ?? null };
}

async function completeJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ result?: unknown }>(request);
  return updateJob(await client.completeJob(id, body.result));
}

async function failJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ error?: string }>(request);
  if (!body.error) return { status: 400, body: { error: 'missing error' } };
  return updateJob(await client.failJob(id, body.error));
}

function updateJob(job: Awaited<ReturnType<GatewayClient['showJob']>>): RestRouteResult {
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}
