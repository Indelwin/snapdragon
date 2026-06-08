import type { GatewayAgentRuntimeDescriptor } from './types.js';

export function normalizeAgentRuntime(
  descriptor: GatewayAgentRuntimeDescriptor,
): GatewayAgentRuntimeDescriptor {
  return {
    ...descriptor,
    supportedJobKinds: descriptor.supportedJobKinds ?? [],
    capabilities: descriptor.capabilities ?? [],
  };
}
