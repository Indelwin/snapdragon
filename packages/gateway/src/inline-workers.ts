import type {
  GatewayLease,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';

type InlineWorkerLogger = (
  level: string,
  target: string | undefined,
  message: string,
  data?: unknown,
) => void;

export class InlineWorkerStore {
  #workers = new Map<string, GatewayWorkerRecord>();

  constructor(private readonly log: InlineWorkerLogger) {}

  register(input: GatewayWorkerRegistration): GatewayWorkerRecord {
    const now = Date.now();
    const existing = this.#workers.get(workerId(input.id));
    const worker = {
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
    } satisfies GatewayWorkerRecord;
    this.#workers.set(worker.id, worker);
    this.log('info', worker.id, 'worker registered');
    return worker;
  }

  heartbeat(input: GatewayWorkerHeartbeat): GatewayWorkerRecord | undefined {
    const worker = this.#workers.get(workerId(input.id));
    if (!worker) return undefined;
    if (input.state) worker.state = input.state;
    if (input.queue) worker.queue = workerField('queue', input.queue);
    if (input.status) worker.status = workerField('status', input.status);
    if (input.lastError) worker.lastError = workerField('lastError', input.lastError);
    if (input.metadata !== undefined) worker.metadata = input.metadata;
    worker.heartbeatAtMs = Date.now();
    return worker;
  }

  list(): GatewayWorkerRecord[] {
    return [...this.#workers.values()].sort((a, b) => b.heartbeatAtMs - a.heartbeatAtMs);
  }

  show(id: string): GatewayWorkerRecord | undefined {
    return this.#workers.get(workerId(id));
  }

  markLeased(workerIdValue: string, queue: string, lease: GatewayLease): void {
    const id = workerId(workerIdValue);
    const worker = this.#workers.get(id) ?? this.register({ id, queue });
    worker.queue = workerField('queue', queue);
    worker.state = 'running';
    worker.currentJobId = lease.jobId;
    worker.currentLeaseId = lease.id;
    worker.leaseExpiresAtMs = lease.expiresAtMs;
    worker.heartbeatAtMs = Date.now();
  }

  clearLease(lease: GatewayLease | undefined): void {
    if (!lease) return;
    const worker = this.#workers.get(workerId(lease.worker));
    if (!worker || worker.currentLeaseId !== lease.id) return;
    worker.state = 'idle';
    worker.currentJobId = undefined;
    worker.currentLeaseId = undefined;
    worker.leaseExpiresAtMs = undefined;
    worker.heartbeatAtMs = Date.now();
  }
}

function workerId(value: string): string {
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
