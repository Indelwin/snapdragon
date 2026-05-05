import type { SdConfig } from './config.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';
import { configuredServiceList, formatLiveService } from './gateway-command-services-format.js';

export async function rustServiceList(config: SdConfig): Promise<string> {
  try {
    const services = await rustGatewayClientForConfig(config).listServices();
    if (services.length === 0) return `${configuredServiceList(config)}No live Rust services.\n`;
    return `gateway services (rust)\n${services.map(formatLiveService).join('\n')}\n`;
  } catch (error) {
    return [
      `Rust gateway unavailable: ${gatewayErrorMessage(error)}`,
      configuredServiceList(config).trimEnd(),
      '',
    ].join('\n');
  }
}

export async function rustRunService(name: string, config: SdConfig): Promise<string> {
  try {
    const status = await rustGatewayClientForConfig(config).runService(name);
    return status ? `${formatLiveService(status)}\n` : `Unknown live gateway service: ${name}\n`;
  } catch (error) {
    return `Rust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}

export async function syncRustServiceEnabled(
  config: SdConfig,
  name: string,
  enabled: boolean,
  action: string,
): Promise<string> {
  try {
    await rustGatewayClientForConfig(config).enableService(name, enabled);
    return `${action} gateway service ${name}\n`;
  } catch (error) {
    return `${action} gateway service ${name} in config\nRust gateway unavailable: ${gatewayErrorMessage(error)}\n`;
  }
}
