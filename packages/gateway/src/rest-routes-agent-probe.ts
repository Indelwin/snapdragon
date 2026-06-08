import { type PiRpcRuntimeOptions, probePiRpcRuntime } from './pi-rpc.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';
import type { GatewayClient } from './types.js';

interface AgentRuntimeProbeRequest {
  kind?: string;
  runtime?: string;
  options?: PiRpcRuntimeOptions;
  save?: boolean;
}

export function isAgentRuntimeProbeRoute(route: RestRoute): boolean {
  return route.method === 'POST' && route.parts[1] === 'probe';
}

export async function probeAgentRuntimeRoute(
  client: GatewayClient,
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<AgentRuntimeProbeRequest>(request);
  const kind = route.parts[2] ?? body.kind ?? body.runtime;
  if (kind === 'pi') return probePiAgentRuntime(client, body);
  if (!kind) return badRequest('missing agent runtime probe kind');
  return badRequest(`unsupported agent runtime probe kind: ${kind}`);
}

async function probePiAgentRuntime(
  client: GatewayClient,
  body: AgentRuntimeProbeRequest,
): Promise<RestRouteResult> {
  try {
    const descriptor = await probePiRpcRuntime(body.options ?? {});
    return {
      status: 200,
      body: body.save ? await client.registerAgentRuntime(descriptor) : descriptor,
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error: 'agent runtime probe failed',
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function badRequest(error: string): RestRouteResult {
  return { status: 400, body: { error } };
}
