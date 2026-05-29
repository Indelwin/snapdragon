import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

export async function dispatchEvents(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET') return listEvents(client, id);
  if (route.method === 'POST') return mutateEvent(client, id, action, request);
  return notFound();
}

async function listEvents(client: GatewayClient, id: string | undefined): Promise<RestRouteResult> {
  if (id) return notFound();
  return { status: 200, body: await client.listEvents() };
}

async function mutateEvent(
  client: GatewayClient,
  id: string | undefined,
  action: string | undefined,
  request: RestRequest,
): Promise<RestRouteResult> {
  if (!id) return appendEvent(client, request);
  if (action === 'cancel') return cancelEvent(client, id);
  return notFound();
}

async function appendEvent(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<Parameters<GatewayClient['appendEvent']>[0]>(request);
  return { status: 201, body: await client.appendEvent(body) };
}

async function cancelEvent(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const event = await client.cancelEvent(id);
  return event ? { status: 200, body: event } : notFound('event not found');
}

function notFound(error = 'not found'): RestRouteResult {
  return { status: 404, body: { error } };
}
