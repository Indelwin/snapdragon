import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function acquireJobRoute(
  client: GatewayClient,
  _route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ leaseMs?: number; queue?: string; worker?: string }>(request);
  const worker = body.worker?.trim();
  if (!worker) return { status: 400, body: { error: 'missing worker id' } };
  const lease = await client.acquireJob(body.queue?.trim() || 'default', worker, body.leaseMs);
  return { status: 200, body: lease ?? null };
}

export async function cancelJobRoute(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  const job = await client.cancelJob(route.parts[1] ?? '');
  return job ? { status: 200, body: job } : notFound('job not found');
}

export async function completeJobRoute(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ result?: unknown }>(request);
  const job = await client.completeJob(route.parts[1] ?? '', body.result);
  return job ? { status: 200, body: job } : notFound('job not found');
}

export async function failJobRoute(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ error?: unknown }>(request);
  const error = typeof body.error === 'string' ? body.error.trim() : '';
  if (!error) return { status: 400, body: { error: 'missing job failure error' } };
  const job = await client.failJob(route.parts[1] ?? '', error);
  return job ? { status: 200, body: job } : notFound('job not found');
}

export async function retryJobRoute(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  const job = await client.retryJob(route.parts[1] ?? '');
  return job ? { status: 200, body: job } : notFound('job not found');
}

function notFound(error: string): RestRouteResult {
  return { status: 404, body: { error } };
}
