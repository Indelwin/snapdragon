import type { GatewayStatus } from '@snapdragon-ai/gateway';
import type { SdDaemonPaths } from './daemon-paths.js';
import { formatRustStatusDetails } from './gateway-rust-status-details.js';

export function formatRustGatewayStatus(
  paths: SdDaemonPaths,
  pid: number | undefined,
  running: boolean,
  status?: GatewayStatus,
  error?: string,
): string {
  const lines = [
    `rust gateway ${running ? 'running' : 'stopped'}${pid ? ` (${pid})` : ''}`,
    `socket: ${paths.gatewaySocket}`,
    `store: ${paths.gatewayDb}`,
  ];
  if (error) lines.push(`error: ${error}`);
  if (status) lines.push(...formatRustStatusDetails(status));
  return `${lines.join('\n')}\n`;
}
