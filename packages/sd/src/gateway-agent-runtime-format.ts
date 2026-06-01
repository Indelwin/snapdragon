import type { GatewayAgentRuntimeDescriptor } from '@snapdragon-ai/gateway';
import { mergeAgentRuntimeDescriptors } from './gateway-agent-runtime-config.js';
import { gatewayErrorMessage } from './gateway-command-client.js';

export function formatAgentRuntimeList(
  saved: GatewayAgentRuntimeDescriptor[],
  registered: GatewayAgentRuntimeDescriptor[],
): string {
  const registeredIds = new Set(registered.map((runtime) => runtime.id));
  const runtimes = mergeAgentRuntimeDescriptors(saved, registered);
  if (runtimes.length === 0) return 'No agent runtimes registered\n';
  return `${runtimes
    .map((runtime) =>
      formatAgentRuntime(runtime, registeredIds.has(runtime.id) ? 'registered' : 'saved'),
    )
    .join('\n')}\n`;
}

export function formatSavedAgentRuntimeList(
  saved: GatewayAgentRuntimeDescriptor[],
  error: unknown,
): string {
  const errorText = `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  if (saved.length === 0) return errorText;
  return `${saved.map((runtime) => formatAgentRuntime(runtime, 'saved')).join('\n')}\n${errorText}`;
}

function formatAgentRuntime(runtime: GatewayAgentRuntimeDescriptor, source: string): string {
  const label = runtime.label ? ` ${runtime.label}` : '';
  return `${runtime.id}\t${runtime.kind}\t${runtime.protocol}${label}\t${source}`;
}
