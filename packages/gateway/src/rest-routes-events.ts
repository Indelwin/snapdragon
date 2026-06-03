import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

type EventRouteHandler = (
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
) => Promise<RestRouteResult>;

const eventRouteHandlers: Record<string, EventRouteHandler> = {
  'GET  ': listEventsRoute,
  'POST  ': appendEventRoute,
  'GET :id ': showEventRoute,
  'DELETE :id ': cancelEventRoute,
  'POST :id cancel': cancelEventRoute,
};

export async function dispatchEvents(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const handler = eventRouteHandlers[eventRouteKey(route)];
  return handler ? handler(client, route, request) : notFound();
}

async function listEventsRoute(client: GatewayClient): Promise<RestRouteResult> {
  return { status: 200, body: await client.listEvents() };
}

async function showEventRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const event = (await client.listEvents()).find((record) => record.id === route.parts[1]);
  return event ? { status: 200, body: event } : notFound('event not found');
}

async function appendEventRoute(
  client: GatewayClient,
  _route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<Parameters<GatewayClient['appendEvent']>[0]>(request);
  return { status: 201, body: await client.appendEvent(body) };
}

async function cancelEventRoute(client: GatewayClient, route: RestRoute): Promise<RestRouteResult> {
  const event = await client.cancelEvent(route.parts[1] ?? '');
  return event ? { status: 200, body: event } : notFound('event not found');
}

function eventRouteKey(route: RestRoute): string {
  const [, id, action = ''] = route.parts;
  return `${route.method} ${id ? ':id' : ''} ${action}`;
}

function notFound(error = 'not found'): RestRouteResult {
  return { status: 404, body: { error } };
}
