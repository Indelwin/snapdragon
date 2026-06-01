import { createPiRpcRuntimeDescriptor, probePiRpcRuntime } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import {
  parsePiRuntimeOptions,
  parsePiRuntimeRegistrationArgs,
} from './gateway-agent-command-args.js';
import {
  configuredAgentRuntime,
  configuredAgentRuntimeDescriptors,
  saveAgentRuntimeToConfig,
} from './gateway-agent-runtime-config.js';
import {
  formatAgentRuntimeList,
  formatSavedAgentRuntimeList,
} from './gateway-agent-runtime-format.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function listAgentRuntimes(args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const saved = configuredAgentRuntimeDescriptors(config);
  try {
    const registered = await rustGatewayClientForConfig(config).listAgentRuntimes();
    return formatAgentRuntimeList(saved, registered);
  } catch (error) {
    return formatSavedAgentRuntimeList(saved, error);
  }
}

export async function showAgentRuntime(id: string | undefined, args: SdCliArgs): Promise<string> {
  if (!id) return 'gateway agents show requires <runtime-id>\n';
  const config = await loadSdConfig(args.configPath);
  const saved = configuredAgentRuntime(config, id);
  try {
    const runtime = await rustGatewayClientForConfig(config).showAgentRuntime(id);
    return runtime || saved
      ? `${JSON.stringify(runtime ?? saved, null, 2)}\n`
      : `Unknown agent runtime: ${id}\n`;
  } catch (error) {
    if (saved) return `${JSON.stringify(saved, null, 2)}\n`;
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

export async function registerPiRuntime(rest: string[], args: SdCliArgs): Promise<string> {
  const config = await loadSdConfig(args.configPath);
  const { options, save } = parsePiRuntimeRegistrationArgs(rest);
  const descriptor = createPiRpcRuntimeDescriptor(options);
  const savedPath = save ? await saveAgentRuntimeToConfig(args.configPath, descriptor) : undefined;
  try {
    const runtime = await rustGatewayClientForConfig(config).registerAgentRuntime(descriptor);
    const savedText = savedPath ? ` saved=${savedPath}` : '';
    return `registered agent runtime ${runtime.id} kind=${runtime.kind} protocol=${runtime.protocol}${savedText}\n`;
  } catch (error) {
    if (savedPath) {
      return `saved agent runtime ${descriptor.id} to ${savedPath}\nRust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
    }
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
