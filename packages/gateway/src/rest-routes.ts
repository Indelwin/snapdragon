import { worldSnapshotOptionsFromSearch } from './rest-query.js';
import { dispatchAgents } from './rest-routes-agents.js';
import { dispatchEvents } from './rest-routes-events.js';
import { dispatchJobs } from './rest-routes-jobs.js';
import {
  dispatchCapabilities,
  dispatchLogs,
  dispatchRegistry,
  dispatchWorkers,
} from './rest-routes-read.js';
import { dispatchServices } from './rest-routes-services.js';
import type { RestRequest, RestRoute, RestRouteResult } from './rest-types.js';
import type { GatewayOrchestrationClient } from './types-runtime.js';

type RouteHandler = (
  client: GatewayOrchestrationClient,
  route: RestRoute,
  request: RestRequest,
) => Promise<RestRouteResult>;

const routeHandlers: Record<string, RouteHandler> = {
  services: dispatchServices,
  agents: dispatchAgents,
  workers: (client, route) => dispatchWorkers(client, route),
  jobs: dispatchJobs,
  events: dispatchEvents,
  logs: (client, route) => dispatchLogs(client, route),
  registry: (client, route) => dispatchRegistry(client, route),
  capabilities: (client, route) => dispatchCapabilities(client, route),
};

export async function dispatchRoute(
  client: GatewayOrchestrationClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const builtin = await dispatchBuiltin(client, route);
  if (builtin) return builtin;
  const [resource, id, action] = route.parts;
  const handler = routeHandlers[resource ?? ''];
  if (handler) return handler(client, route, request);
  if (resource === 'sandboxes' && route.method === 'GET' && !id && !action)
    return { status: 200, body: [] };
  return { status: 404, body: { error: 'not found' } };
}

async function dispatchBuiltin(
  client: GatewayOrchestrationClient,
  route: RestRoute,
): Promise<RestRouteResult | undefined> {
  const [resource] = route.parts;
  if (route.method !== 'GET') return undefined;
  if (resource === 'health') return { status: 200, body: { ok: true, runtime: client.runtime } };
  if (resource === 'status') return { status: 200, body: await client.status() };
  if (resource === 'world') {
    return {
      status: 200,
      body: await client.worldSnapshot(worldSnapshotOptionsFromSearch(route.searchParams)),
    };
  }
  return undefined;
}
