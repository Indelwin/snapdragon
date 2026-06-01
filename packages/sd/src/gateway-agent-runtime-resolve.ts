import type { GatewayAgentRuntimeDescriptor, GatewayClient } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config-schema.js';
import { configuredAgentRuntime } from './gateway-agent-runtime-config.js';

export async function resolveAgentRuntime(
  client: GatewayClient,
  config: SdConfig,
  id: string,
): Promise<GatewayAgentRuntimeDescriptor | undefined> {
  const registered = await client.showAgentRuntime(id);
  return registered ?? configuredAgentRuntime(config, id);
}

export async function registerSavedAgentRuntime(
  client: GatewayClient,
  config: SdConfig,
  id: string,
): Promise<GatewayAgentRuntimeDescriptor | undefined> {
  const registered = await client.showAgentRuntime(id);
  if (registered) return registered;
  const saved = configuredAgentRuntime(config, id);
  return saved ? client.registerAgentRuntime(saved) : undefined;
}
