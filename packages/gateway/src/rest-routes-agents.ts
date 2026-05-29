import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayAgentRuntimeDescriptor, GatewayClient } from './types.js';

export async function dispatchAgents(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET' && !id) {
    return { status: 200, body: await client.listAgentRuntimes() };
  }
  if (route.method === 'GET' && id) return showAgentRuntime(client, id);
  if (route.method === 'POST' && (!id || id === 'register') && !action) {
    return registerAgentRuntime(client, request);
  }
  return { status: 404, body: { error: 'not found' } };
}

async function showAgentRuntime(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const runtime = await client.showAgentRuntime(id);
  return runtime
    ? { status: 200, body: runtime }
    : { status: 404, body: { error: 'agent runtime not found' } };
}

async function registerAgentRuntime(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ descriptor?: GatewayAgentRuntimeDescriptor }>(request);
  if (!body.descriptor) return { status: 400, body: { error: 'missing agent descriptor' } };
  return { status: 201, body: await client.registerAgentRuntime(body.descriptor) };
}
