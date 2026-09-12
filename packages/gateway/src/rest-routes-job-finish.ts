import { type FencedJobBody, fenceFromBody, missingFence } from './rest-routes-job-fence.js';
import { type RestRequest, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function completeJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<FencedJobBody & { result?: unknown }>(request);
  const fence = fenceFromBody(body);
  if (!fence) return missingFence();
  const job = await client.completeJob(id, body.result, fence);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}

export async function failJob(
  client: GatewayClient,
  id: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<FencedJobBody & { error?: string; message?: string }>(request);
  const error = body.error ?? body.message;
  if (!error) return { status: 400, body: { error: 'error is required' } };
  const fence = fenceFromBody(body);
  if (!fence) return missingFence();
  const job = await client.failJob(id, error, fence);
  return job ? { status: 200, body: job } : { status: 404, body: { error: 'job not found' } };
}
