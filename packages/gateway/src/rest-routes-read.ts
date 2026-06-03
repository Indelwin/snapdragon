import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayLogInput } from './types.js';

export async function dispatchLogs(
  client: GatewayClient,
  route: RestRoute,
  request?: RestRequest,
): Promise<RestRouteResult> {
  if (route.method === 'POST' && request) return appendLog(client, request);
  if (route.method !== 'GET') return { status: 404, body: { error: 'not found' } };
  return {
    status: 200,
    body: await client.tailLogs({
      target: route.searchParams.get('target') ?? undefined,
      limit: parseLimit(route.searchParams.get('limit')),
    }),
  };
}

async function appendLog(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<GatewayLogInput>(request);
  if (!body || typeof body !== 'object' || typeof body.message !== 'string') {
    return { status: 400, body: { error: 'missing log message' } };
  }
  if (body.message.trim() === '') return { status: 400, body: { error: 'missing log message' } };
  return { status: 201, body: await client.appendLog(body) };
}

export async function dispatchRegistry(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (route.method !== 'GET') return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: await client.registrySnapshot() };
}

export async function dispatchCapabilities(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (route.method !== 'GET') return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: (await client.registrySnapshot()).capabilities };
}

function parseLimit(value: string | null): number {
  const limit = Number(value ?? 20);
  return Number.isFinite(limit) ? limit : 20;
}
