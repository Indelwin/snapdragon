import { existsSync } from 'node:fs';
import type { GatewaySandboxLease } from '@snapdragon-ai/gateway';
import type { SdConfig } from './config.js';
import { daemonPathsForConfig } from './daemon-paths.js';
import { gatewayErrorMessage, rustGatewayClientForConfig } from './gateway-command-client.js';

export async function registerGatewaySandboxLease(
  config: SdConfig,
  lease: GatewaySandboxLease,
): Promise<string | undefined> {
  const unavailable = unavailableGateway(config);
  if (unavailable) return unavailable;
  try {
    await rustGatewayClientForConfig(config).registerSandboxLease(lease);
    return undefined;
  } catch (error) {
    return gatewayErrorMessage(error);
  }
}

export async function listGatewaySandboxLeases(
  config: SdConfig,
): Promise<{ leases: GatewaySandboxLease[]; error?: string }> {
  const unavailable = unavailableGateway(config);
  if (unavailable) return { leases: [], error: unavailable };
  try {
    return { leases: await rustGatewayClientForConfig(config).listSandboxLeases() };
  } catch (error) {
    return { leases: [], error: gatewayErrorMessage(error) };
  }
}

export async function releaseGatewaySandboxLease(
  config: SdConfig,
  id: string,
): Promise<{ lease?: GatewaySandboxLease; error?: string }> {
  const unavailable = unavailableGateway(config);
  if (unavailable) return { error: unavailable };
  try {
    return { lease: await rustGatewayClientForConfig(config).releaseSandboxLease(id) };
  } catch (error) {
    return { error: gatewayErrorMessage(error) };
  }
}

function unavailableGateway(config: SdConfig): string | undefined {
  const socket = daemonPathsForConfig(config).gatewaySocket;
  return existsSync(socket) ? undefined : `socket not found at ${socket}`;
}
