import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient, GatewaySandboxSpec } from './types.js';

export async function dispatchSandboxes(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET' && !id) return { status: 200, body: await client.listSandboxLeases() };
  if (route.method === 'GET' && id) return showSandbox(client, id);
  if (route.method === 'POST' && !id) return leaseSandbox(client, request);
  if (route.method === 'POST' && id && action === 'release') return releaseSandbox(client, id);
  return { status: 404, body: { error: 'not found' } };
}

async function showSandbox(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const lease = await client.showSandboxLease(id);
  return lease
    ? { status: 200, body: lease }
    : { status: 404, body: { error: 'sandbox not found' } };
}

async function leaseSandbox(client: GatewayClient, request: RestRequest): Promise<RestRouteResult> {
  const body = await readJson<{ spec?: GatewaySandboxSpec } & GatewaySandboxSpec>(request);
  try {
    return { status: 201, body: await client.leaseSandbox(body.spec ?? body) };
  } catch (error) {
    return { status: 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

async function releaseSandbox(client: GatewayClient, id: string): Promise<RestRouteResult> {
  const lease = await client.releaseSandbox(id);
  return lease
    ? { status: 200, body: lease }
    : { status: 404, body: { error: 'sandbox not found' } };
}
