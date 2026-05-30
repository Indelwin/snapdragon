import {
  createPiRpcRuntimeDescriptor,
  type GatewayAgentRuntimeDescriptor,
  probePiRpcRuntime,
} from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { parsePiRuntimeOptions } from './gateway-agent-command-args.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function listAgentRuntimes(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  try {
    const runtimes = await rustGatewayClientForConfig(config).listAgentRuntimes();
    if (runtimes.length === 0) return 'No agent runtimes registered\n';
    return `${runtimes.map(formatAgentRuntime).join('\n')}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

export async function showAgentRuntime(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway agents show requires <runtime-id>\n';
  const config = await loadSdConfig(args.configPath);
  try {
    const runtime = await rustGatewayClientForConfig(config).showAgentRuntime(id);
    return runtime ? `${JSON.stringify(runtime, null, 2)}\n` : `Unknown agent runtime: ${id}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

export async function registerPiRuntime(rest: string[], args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const descriptor = createPiRpcRuntimeDescriptor(parsePiRuntimeOptions(rest));
  try {
    const runtime = await rustGatewayClientForConfig(config).registerAgentRuntime(descriptor);
    return `registered agent runtime ${runtime.id} kind=${runtime.kind} protocol=${runtime.protocol}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

export async function probePiRuntime(rest: string[]): Promise<string> {
  try {
    const descriptor = await probePiRpcRuntime(parsePiRuntimeOptions(rest));
    return `${JSON.stringify(descriptor, null, 2)}\n`;
  } catch (error) {
    return `Pi RPC probe failed: ${gatewayErrorMessage(error)}\n`;
  }
}

function formatAgentRuntime(runtime: GatewayAgentRuntimeDescriptor): string {
  const label = runtime.label ? ` ${runtime.label}` : '';
  return `${runtime.id}\t${runtime.kind}\t${runtime.protocol}${label}`;
}
