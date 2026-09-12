import type {
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';

export function workerFromRegistration(
  input: GatewayWorkerRegistration,
  existing: GatewayWorkerRecord | undefined,
  now = Date.now(),
): GatewayWorkerRecord {
  return {
    id: workerId(input.id),
    queue: workerField('queue', input.queue ?? existing?.queue ?? 'default'),
    runtimeId: optionalWorkerField('runtimeId', input.runtimeId),
    service: optionalWorkerField('service', input.service),
    capabilities: (input.capabilities ?? []).map((value) => workerField('capability', value)),
    state: existing?.state ?? 'idle',
    registeredAtMs: existing?.registeredAtMs ?? now,
    heartbeatAtMs: now,
    currentJobId: existing?.currentJobId,
    currentLeaseId: existing?.currentLeaseId,
    leaseExpiresAtMs: existing?.leaseExpiresAtMs,
    status: optionalWorkerField('status', input.status),
    lastError: existing?.lastError,
    metadata: input.metadata,
  };
}

export function applyWorkerHeartbeat(
  worker: GatewayWorkerRecord,
  input: GatewayWorkerHeartbeat,
): void {
  if (worker.currentLeaseId) worker.state = 'running';
  else if (input.state) worker.state = input.state;
  if (input.queue) worker.queue = workerField('queue', input.queue);
  if (input.status) worker.status = workerField('status', input.status);
  if (input.lastError) worker.lastError = workerField('lastError', input.lastError);
  if (input.metadata !== undefined) worker.metadata = input.metadata;
  worker.heartbeatAtMs = Date.now();
}

export function workerId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error('gateway worker id must be non-empty');
  if (!/^[A-Za-z0-9._:-]+$/.test(id)) {
    throw new Error('gateway worker id must contain only letters, numbers, ".", "_", "-", or ":"');
  }
  return id;
}

function optionalWorkerField(field: string, value: string | undefined): string | undefined {
  return value === undefined ? undefined : workerField(field, value);
}

function workerField(field: string, value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`gateway worker ${field} must be non-empty`);
  return normalized;
}

export function cloneWorker(worker: GatewayWorkerRecord): GatewayWorkerRecord {
  return {
    ...worker,
    capabilities: [...worker.capabilities],
    metadata: cloneValue(worker.metadata),
  };
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
