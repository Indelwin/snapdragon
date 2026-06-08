import type { GatewayStatus, GatewayWorkerRecord } from '@snapdragon-ai/gateway';

type GatewayWorkerProcess = NonNullable<GatewayStatus['workerProcesses']>[number];

export function formatJobWorkers(status: GatewayStatus): string {
  const workers = status.workers ?? [];
  if (workers.length === 0) return 'none';
  return workers.slice(-4).map(formatJobWorker).join(', ');
}

export function formatWorkerProcesses(status: GatewayStatus): string {
  const workers = status.workerProcesses ?? [];
  if (workers.length === 0) return 'none';
  return workers.slice(-4).map(formatWorkerProcess).join(', ');
}

function formatJobWorker(worker: GatewayWorkerRecord): string {
  const service = worker.service ? ` service=${worker.service}` : '';
  const job = worker.currentJobId ? ` job=${worker.currentJobId}` : '';
  const status = worker.status ? ` ${worker.status}` : '';
  return `${worker.id}:${worker.state} queue=${worker.queue}${service}${job}${status}`;
}

function formatWorkerProcess(worker: GatewayWorkerProcess): string {
  const pid = worker.pid ? ` pid=${worker.pid}` : '';
  const reason = worker.lastError ? ` ${worker.lastError}` : '';
  return `${worker.service}:${worker.state}${pid}${reason}`;
}
