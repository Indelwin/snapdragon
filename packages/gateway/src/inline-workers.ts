import {
  applyWorkerHeartbeat,
  cloneWorker,
  workerFromRegistration,
  workerId,
} from './inline-worker-helpers.js';
import {
  assertWorkerAvailable,
  clearWorkerLease,
  markWorkerLeased,
  renewWorkerLease,
} from './inline-worker-leases.js';
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
    const existing = this.#workers.get(workerId(input.id));
    const worker = workerFromRegistration(input, existing);
    this.#workers.set(worker.id, worker);
    this.log('info', worker.id, 'worker registered');
    return cloneWorker(worker);
  }

  heartbeat(input: GatewayWorkerHeartbeat): GatewayWorkerRecord | undefined {
    const worker = this.#workers.get(workerId(input.id));
    if (!worker) return undefined;
    applyWorkerHeartbeat(worker, input);
    return cloneWorker(worker);
  }

  list(): GatewayWorkerRecord[] {
    return [...this.#workers.values()]
      .sort((a, b) => b.heartbeatAtMs - a.heartbeatAtMs)
      .map(cloneWorker);
  }

  show(id: string): GatewayWorkerRecord | undefined {
    const worker = this.#workers.get(workerId(id));
    return worker ? cloneWorker(worker) : undefined;
  }

  assertAvailable(workerIdValue: string): void {
    const id = workerId(workerIdValue);
    assertWorkerAvailable(this.#workers.get(id), id);
  }

  markLeased(workerIdValue: string, queue: string, lease: GatewayLease): void {
    const id = workerId(workerIdValue);
    if (!this.#workers.has(id)) this.register({ id, queue });
    const worker = this.#workers.get(id);
    if (!worker) throw new Error(`gateway worker ${id} was not registered`);
    markWorkerLeased(worker, queue, lease);
  }

  renewLease(lease: GatewayLease): void {
    renewWorkerLease(this.#workers.get(workerId(lease.worker)), lease);
  }

  clearLease(lease: GatewayLease | undefined): void {
    if (lease) clearWorkerLease(this.#workers.get(workerId(lease.worker)), lease);
  }
}
