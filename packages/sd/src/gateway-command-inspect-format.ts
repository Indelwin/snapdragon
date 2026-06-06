import type { GatewayWorldSnapshot } from '@snapdragon-ai/gateway';
import { filterInspectSnapshot } from './gateway-command-inspect-filter.js';
import {
  formatInspectJob,
  formatInspectLease,
  formatInspectLog,
  formatInspectQueueDepths,
  formatInspectRuntime,
  formatInspectSandbox,
  formatInspectService,
  formatInspectWorker,
} from './gateway-command-inspect-format-rows.js';
import type { GatewayInspectOptions } from './gateway-command-inspect-options.js';

export function formatGatewayInspection(
  snapshot: GatewayWorldSnapshot,
  options: GatewayInspectOptions = { logLimit: 20 },
): string {
  const filtered = filterInspectSnapshot(snapshot, options);
  const lines = [
    inspectionTitle(options),
    `runtime: ${snapshot.runtime} captured=${new Date(snapshot.capturedAtMs).toISOString()}`,
    `queues: ${formatInspectQueueDepths(filtered.queueDepths)}`,
    ...section('jobs', filtered.jobs, formatInspectJob),
    ...section('workers', filtered.workers, formatInspectWorker),
    ...section('agent runtimes', filtered.agentRuntimes, formatInspectRuntime),
    ...section('services', filtered.services, formatInspectService),
    ...section('leases', filtered.leases, formatInspectLease),
    ...section('sandboxes', filtered.sandboxes, formatInspectSandbox),
    ...section('logs', filtered.logs, formatInspectLog),
  ];
  if (!hasOperationalRows(filtered)) lines.push('No matching gateway entities.');
  return `${lines.join('\n')}\n`;
}

function inspectionTitle(options: GatewayInspectOptions): string {
  return options.target ? `gateway inspect ${options.target}` : 'gateway inspect';
}

function section<T>(name: string, rows: T[], format: (row: T) => string): string[] {
  if (rows.length === 0) return [`${name}: none`];
  return [`${name}:`, ...rows.map((row) => `  ${format(row)}`)];
}

function hasOperationalRows(snapshot: GatewayWorldSnapshot): boolean {
  return [
    snapshot.jobs,
    snapshot.workers,
    snapshot.agentRuntimes,
    snapshot.services,
    snapshot.leases,
    snapshot.sandboxes,
    snapshot.logs,
  ].some((rows) => rows.length > 0);
}
