import type { GatewayWorldSnapshot, GatewayWorldSnapshotOptions } from '@snapdragon-ai/gateway';
import {
  formatInspectJob,
  formatInspectLease,
  formatInspectLog,
  formatInspectQueueDepths,
  formatInspectRuntime,
  formatInspectSandbox,
  formatInspectService,
  formatInspectWorker,
  formatInspectWorkerProcess,
} from './gateway-command-inspect-format-rows.js';

export function formatGatewayInspection(
  snapshot: GatewayWorldSnapshot,
  options: GatewayWorldSnapshotOptions = {},
): string {
  const lines = [
    inspectionTitle(options),
    `runtime: ${snapshot.runtime} captured=${new Date(snapshot.capturedAtMs).toISOString()}`,
    `queues: ${formatInspectQueueDepths(snapshot.queueDepths)}`,
    ...section('jobs', snapshot.jobs, formatInspectJob),
    ...section('workers', snapshot.workers, formatInspectWorker),
    ...section('agent runtimes', snapshot.agentRuntimes, formatInspectRuntime),
    ...section('services', snapshot.services, formatInspectService),
    ...section('worker processes', snapshot.workerProcesses, formatInspectWorkerProcess),
    ...section('leases', snapshot.leases, formatInspectLease),
    ...section('sandboxes', snapshot.sandboxes, formatInspectSandbox),
    ...section('logs', snapshot.logs, formatInspectLog),
  ];
  if (!hasOperationalRows(snapshot)) lines.push('No matching gateway entities.');
  return `${lines.join('\n')}\n`;
}

function inspectionTitle(options: GatewayWorldSnapshotOptions): string {
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
    snapshot.workerProcesses,
    snapshot.leases,
    snapshot.sandboxes,
    snapshot.logs,
  ].some((rows) => rows.length > 0);
}
