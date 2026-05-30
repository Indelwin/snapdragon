import { DEFAULT_PI_COMMAND, DEFAULT_RPC_ARGS, type PiRpcRuntimeOptions } from './pi-rpc-types.js';
import type { GatewayAgentRuntimeDescriptor, GatewayServiceWorkerSpec } from './types.js';

export function createPiRpcRuntimeDescriptor(
  options: PiRpcRuntimeOptions = {},
): GatewayAgentRuntimeDescriptor {
  const worker: GatewayServiceWorkerSpec = {
    command: options.command ?? DEFAULT_PI_COMMAND,
    args: options.args ?? DEFAULT_RPC_ARGS,
    cwd: options.cwd,
    env: piRuntimeEnv(options),
  };
  return {
    id: options.id ?? 'pi',
    kind: 'pi',
    protocol: 'jsonl',
    label: options.label ?? 'Pi Agent',
    command: worker,
    supportedJobKinds: ['agent.run'],
    capabilities: ['llm.chat', 'tools.pi', 'skills.pi', 'extensions.pi'],
    isolation: 'profile',
    metadata: {
      adapter: '@snapdragon-ai/gateway/pi-rpc',
      command: worker.command,
      args: worker.args,
    },
  };
}

export function piRuntimeEnv(options: PiRpcRuntimeOptions): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  if (options.agentDir) env.PI_CODING_AGENT_DIR = options.agentDir;
  if (options.sessionDir) env.PI_CODING_AGENT_SESSION_DIR = options.sessionDir;
  return Object.keys(env).length > 0 ? env : undefined;
}

export function commandCount(data: unknown): number {
  if (!isCommandList(data)) return 0;
  return data.commands.length;
}

function isCommandList(data: unknown): data is { commands: unknown[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    !Array.isArray(data) &&
    Array.isArray((data as { commands?: unknown }).commands)
  );
}
