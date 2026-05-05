import { RustGatewayClient } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';

export function rustGatewayClientForConfig(config: SdConfig): RustGatewayClient {
  return new RustGatewayClient({ socketPath: daemonPathsForConfig(config).gatewaySocket });
}

export function gatewayErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
