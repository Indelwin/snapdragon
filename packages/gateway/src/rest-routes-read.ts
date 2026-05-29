import type { RestRoute, RestRouteResult } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function dispatchWorkers(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (route.method !== 'GET' || route.parts[1])
    return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: (await client.status()).workerProcesses ?? [] };
}

export async function dispatchLogs(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (route.method !== 'GET') return { status: 404, body: { error: 'not found' } };
  return {
    status: 200,
    body: await client.tailLogs({
      target: route.searchParams.get('target') ?? undefined,
      limit: parseLimit(route.searchParams.get('limit')),
    }),
  };
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
