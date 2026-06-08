import { filterServices } from './query-filters.js';
import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewayServiceSpec } from './types.js';

export async function dispatchServices(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, name, action] = route.parts;
  if (route.method === 'GET') return listServices(client, name, route);
  if (route.method === 'POST') return mutateService(client, name, action, request);
  return notFound();
}

async function listServices(
  client: GatewayClient,
  name: string | undefined,
  route: RestRoute,
): Promise<RestRouteResult> {
  if (name) return notFound();
  const options = worldSnapshotOptionsFromSearch(route.searchParams);
  return { status: 200, body: filterServices(await client.listServices(), options) };
}

async function mutateService(
  client: GatewayClient,
  name: string | undefined,
  action: string | undefined,
  request: RestRequest,
): Promise<RestRouteResult> {
  if (!name) return registerService(client, request);
  if (action === 'run') return runService(client, name);
  if (action === 'enable') return enableService(client, name, request);
  return notFound();
}

async function runService(client: GatewayClient, name: string): Promise<RestRouteResult> {
  return { status: 200, body: await client.runService(name) };
}

async function enableService(
  client: GatewayClient,
  name: string,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ enabled?: boolean }>(request);
  await client.enableService(name, body.enabled ?? true);
  return { status: 200, body: await client.listServices() };
}

async function registerService(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ spec?: GatewayServiceSpec }>(request);
  if (!body.spec) return badRequest('missing service spec');
  await client.registerService(body.spec);
  return { status: 201, body: body.spec };
}

function badRequest(error: string): RestRouteResult {
  return { status: 400, body: { error } };
}

function notFound(): RestRouteResult {
  return { status: 404, body: { error: 'not found' } };
}
