import { normalizeGatewayAgentRuntimeDescriptor } from './agent-runtime-validation.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayAgentRuntimeDescriptor, GatewayClient } from './types.js';

type AgentRouteHandler = (
  client: GatewayClient,
  route: RestRoute,
  request?: RestRequest,
) => Promise<RestRouteResult>;

const agentRouteHandlers: Record<string, AgentRouteHandler> = {
  'GET  ': listAgentRuntimesRoute,
  'POST  ': registerAgentRuntimeRoute,
  'POST register ': registerAgentRuntimeRoute,
  'GET :id ': showAgentRuntimeRoute,
  'DELETE :id ': unregisterAgentRuntimeRoute,
  'POST :id unregister': unregisterAgentRuntimeRoute,
};

export async function dispatchAgents(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const handler = agentRouteHandlers[agentRouteKey(route)];
  return handler ? handler(client, route, request) : notFound();
}

async function listAgentRuntimesRoute(client: GatewayClient): Promise<RestRouteResult> {
  return { status: 200, body: await client.listAgentRuntimes() };
}

async function showAgentRuntimeRoute(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  const id = route.parts[1] ?? '';
  const runtime = await client.showAgentRuntime(id);
  return runtime
    ? { status: 200, body: runtime }
    : { status: 404, body: { error: 'agent runtime not found' } };
}

async function registerAgentRuntimeRoute(
  client: GatewayClient,
  _route: RestRoute,
  request?: RestRequest,
): Promise<RestRouteResult> {
  if (!request) return { status: 400, body: { error: 'missing agent descriptor' } };
  const body = await readJson<{ descriptor?: GatewayAgentRuntimeDescriptor }>(request);
  if (!body.descriptor) return { status: 400, body: { error: 'missing agent descriptor' } };
  let descriptor: GatewayAgentRuntimeDescriptor;
  try {
    descriptor = normalizeGatewayAgentRuntimeDescriptor(body.descriptor);
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
  return { status: 201, body: await client.registerAgentRuntime(descriptor) };
}

async function unregisterAgentRuntimeRoute(
  client: GatewayClient,
  route: RestRoute,
): Promise<RestRouteResult> {
  const id = route.parts[1] ?? '';
  const runtime = await client.unregisterAgentRuntime(id);
  return runtime
    ? { status: 200, body: runtime }
    : { status: 404, body: { error: 'agent runtime not found' } };
}

function agentRouteKey(route: RestRoute): string {
  const [, id, action = ''] = route.parts;
  const target = agentRouteTarget(route.method, id, action);
  return `${route.method} ${target} ${action}`;
}

function agentRouteTarget(method: string, id: string | undefined, action: string): string {
  if (method === 'POST' && id === 'register' && !action) return 'register';
  return id ? ':id' : '';
}

function notFound(): RestRouteResult {
  return { status: 404, body: { error: 'not found' } };
}
