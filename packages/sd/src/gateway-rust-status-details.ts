import type { GatewayServiceStatus, GatewayStatus } from '@snapdragon-ai/gateway';
import { formatJobWorkers, formatWorkerProcesses } from './gateway-rust-worker-status.js';

export function formatRustStatusDetails(status: GatewayStatus): string[] {
  return [
    `pid: ${status.pid ?? 'unknown'} uptime=${formatDuration(status.uptimeMs ?? 0)}`,
    `processes: ${status.processes}`,
    `job workers: ${formatJobWorkers(status)}`,
    `worker processes: ${formatWorkerProcesses(status)}`,
    `service tasks: ${status.serviceTasks?.length ? status.serviceTasks.join(', ') : 'none'}`,
    `tables: ${status.tables.length ? status.tables.join(', ') : 'none'}`,
    `jobs: pending=${status.jobsPending ?? 0} running=${status.jobsRunning ?? 0}`,
    `queues: ${formatQueueDepths(status)}`,
    `leases: ${status.activeLeases?.length ?? 0}`,
    'services:',
    ...formatServiceLines(status.services),
    ...formatRecentFailures(status),
  ];
}

function formatServiceLines(services: GatewayServiceStatus[]): string[] {
  if (services.length === 0) return ['  none'];
  return services.map(formatServiceLine);
}

function formatServiceLine(service: GatewayServiceStatus): string {
  const next = service.nextRunAtMs ? ` next=${formatTime(service.nextRunAtMs)}` : '';
  const suppressed = service.restartSuppressed ? ' restart=suppressed' : '';
  return `  ${service.name}\t${service.state}\truns=${service.runs} errors=${service.errors} consecutive=${service.consecutiveErrors ?? 0}${next}${suppressed}`;
}

function formatQueueDepths(status: GatewayStatus): string {
  const depths = status.queueDepths ?? [];
  if (depths.length === 0) return 'none';
  return depths.map((depth) => `${depth.queue} p=${depth.pending} r=${depth.running}`).join(', ');
}

function formatRecentFailures(status: GatewayStatus): string[] {
  const failures = status.recentFailures ?? [];
  if (failures.length === 0) return [];
  return [
    'recent failures:',
    ...failures.map(
      (failure) => `  ${failure.level}\t${failure.target ?? '-'}\t${failure.message}`,
    ),
  ];
}

function formatTime(ms: number): string {
  return new Date(ms).toISOString();
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${seconds % 60}s`;
}
