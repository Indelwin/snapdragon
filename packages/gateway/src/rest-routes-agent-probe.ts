import { type PiRpcRuntimeOptions, probePiRpcRuntime } from './pi-rpc.js';
import { type RestRequest, type RestRoute, type RestRouteResult, readJson } from './rest-types.js';

interface AgentRuntimeProbeRequest {
  kind?: string;
  runtime?: string;
  options?: PiRpcRuntimeOptions;
}

export function isAgentRuntimeProbeRoute(route: RestRoute): boolean {
  return route.method === 'POST' && route.parts[1] === 'probe';
}

export async function probeAgentRuntimeRoute(
  route: RestRoute,
  request: RestRequest,
): Promise<RestRouteResult> {
  const body = await readJson<AgentRuntimeProbeRequest>(request);
  const kind = route.parts[2] ?? body.kind ?? body.runtime;
  if (kind === 'pi') return probePiAgentRuntime(body.options ?? {});
  if (!kind) return { status: 400, body: { error: 'missing agent runtime probe kind' } };
  return { status: 400, body: { error: `unsupported agent runtime probe kind: ${kind}` } };
}

async function probePiAgentRuntime(options: PiRpcRuntimeOptions): Promise<RestRouteResult> {
  try {
    return { status: 200, body: await probePiRpcRuntime(options) };
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
