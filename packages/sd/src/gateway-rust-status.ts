import type { GatewayServiceStatus, GatewayStatus } from '@snapdragon-ai/gateway';
import type { SdDaemonPaths } from './daemon-paths.js';

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
  ];
  if (error) lines.push(`error: ${error}`);
  if (status) lines.push(...formatRustStatusDetails(status));
  return `${lines.join('\n')}\n`;
}

function formatRustStatusDetails(status: GatewayStatus): string[] {
  return [
    `processes: ${status.processes}`,
    `tables: ${status.tables.length ? status.tables.join(', ') : 'none'}`,
    'services:',
    ...formatServiceLines(status.services),
  ];
}

function formatServiceLines(services: GatewayServiceStatus[]): string[] {
  if (services.length === 0) return ['  none'];
  return services.map((service) => {
    return `  ${service.name}\t${service.state}\truns=${service.runs} errors=${service.errors}`;
  });
}
