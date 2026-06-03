import type {
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from '@snapdragon-ai/gateway';

export function workerRegistrationFromParts(
  id: string,
  parts: string[],
): GatewayWorkerRegistration {
  const options = optionsFromParts(parts);
  return {
    id,
    queue: optionValue(options, 'queue'),
    runtimeId: optionValue(options, 'runtime'),
    service: optionValue(options, 'service'),
    capabilities: options.capability ?? options.capabilities ?? [],
    status: optionValue(options, 'status'),
  };
}

export function workerHeartbeatFromParts(id: string, parts: string[]): GatewayWorkerHeartbeat {
  const options = optionsFromParts(parts);
  return {
    id,
    state: optionValue(options, 'state') as GatewayWorkerRecord['state'] | undefined,
    queue: optionValue(options, 'queue'),
    status: optionValue(options, 'status'),
  };
}

export function formatWorker(worker: GatewayWorkerRecord): string {
  const current = worker.currentJobId ? ` job=${worker.currentJobId}` : '';
  const runtime = worker.runtimeId ? ` runtime=${worker.runtimeId}` : '';
  const status = worker.status ? ` status=${worker.status}` : '';
  return `${worker.id}\t${worker.state}\tqueue=${worker.queue}${runtime}${current}${status}`;
}

function optionsFromParts(parts: string[]): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part?.startsWith('--')) continue;
    const key = part.slice(2);
    const value = parts[i + 1];
    if (!value || value.startsWith('--')) continue;
    options[key] = [...(options[key] ?? []), value];
    i += 1;
  }
  return options;
}

function optionValue(options: Record<string, string[]>, key: string): string | undefined {
  return options[key]?.[0];
}
