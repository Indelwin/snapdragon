import type { GatewayOrchestrationClient } from '@snapdragon-ai/gateway';
import type { SdCliArgs } from './args-types.js';
import { loadSdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import { formatGatewayInspection } from './gateway-command-inspect-format.js';
import { inspectOptionsFromParts } from './gateway-command-inspect-options.js';

export async function inspectCommand(rest: string[], args: SdCliArgs): Promise<string> {
  const options = inspectOptionsFromParts(rest);
  const config = await loadSdConfig(args.configPath);
  try {
    const client = rustGatewayClientForConfig(config) as GatewayOrchestrationClient;
    return formatGatewayInspection(await client.worldSnapshot(), options);
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}
