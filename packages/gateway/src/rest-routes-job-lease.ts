import { type FencedJobBody, fenceFromBody, missingFence } from './rest-routes-job-fence.js';
import { type RestRequest, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function acquireJob(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ queue?: string; worker?: string; leaseMs?: number }>(request);
  if (!body.worker) return { status: 400, body: { error: 'worker is required' } };
  const lease = await client.acquireJob(body.queue ?? 'default', body.worker, body.leaseMs);
  return { status: 200, body: lease ?? null };
}

export async function renewJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<FencedJobBody & { leaseMs?: number }>(request);
  const fence = fenceFromBody(body);
  if (!fence) return missingFence();
  const lease = await client.renewJob(id, fence, body.leaseMs);
  return lease ? { status: 200, body: lease } : { status: 404, body: { error: 'job not found' } };
}
