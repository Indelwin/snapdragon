import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';

export async function dispatchSandboxes(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const [, id, action] = route.parts;
  if (route.method === 'GET') return getSandboxRoute(client, id, action);
  if (route.method === 'POST') return postSandboxRoute(client, request, id, action);
  return { status: 404, body: { error: 'not found' } };
}

async function getSandboxRoute(
  client: GatewayClient,
  id: string | undefined,
  action: string | undefined,
): Promise<RestRouteResult> {
  if (!id && !action) return { status: 200, body: await client.listSandboxLeases() };
  if (id && !action) return sandboxResult(await client.showSandboxLease(id));
  return { status: 404, body: { error: 'not found' } };
}

async function postSandboxRoute(
  client: GatewayClient,
  request: RestRequest,
  id: string | undefined,
  action: string | undefined,
): Promise<RestRouteResult> {
  if (id === 'register' && !action) return registerSandbox(client, request);
  if (id && action === 'release') return sandboxResult(await client.releaseSandboxLease(id));
  return { status: 404, body: { error: 'not found' } };
}

async function registerSandbox(
  client: GatewayClient,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<{ lease?: GatewaySandboxLease } & GatewaySandboxLease>(request);
  return { status: 201, body: await client.registerSandboxLease(body.lease ?? body) };
}

function sandboxResult(lease: GatewaySandboxLease | undefined): RestRouteResult {
  return lease
    ? { status: 200, body: lease }
    : { status: 404, body: { error: 'sandbox lease not found' } };
}
