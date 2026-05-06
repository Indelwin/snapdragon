import { InlineJobStore } from './inline-jobs.js';
import { InlineMailboxStore } from './inline-mailboxes.js';
import { InlineCapabilityRegistry } from './inline-registry.js';
import { InlineServiceStore } from './inline-services.js';
import { InlineTableStore } from './inline-tables.js';
import type {
  ActorId,
  GatewayClient,
  GatewayEnvelope,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLogRecord,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
} from './types.js';

export class InlineGatewayClient implements GatewayClient {
  readonly runtime = 'inline-ts' as const;
  #mailboxes = new InlineMailboxStore();
  #services = new InlineServiceStore();
  #capabilities = new InlineCapabilityRegistry();
  #tables = new InlineTableStore();
  #jobs = new InlineJobStore({
    log: (level, target, message, data) => this.#log(level, target, message, data),
  });
  #events = new Map<string, GatewayEventRecord>();
  #logs: GatewayLogRecord[] = [];

  async send(envelope: GatewayEnvelope): Promise<void> {
    this.#mailboxes.send(envelope);
  }

  async receive(
    actor: ActorId,
    filter: GatewayReceiveFilter = {},
  ): Promise<GatewayEnvelope | undefined> {
    return this.#mailboxes.receive(actor, filter);
  }

  async registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    this.#services.register(spec, runner);
  }

  async enableService(name: string, enabled: boolean): Promise<void> {
    this.#services.enable(name, enabled);
  }

  async runService(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined> {
    return this.#services.run(name, signal);
  }

  async listServices(): Promise<GatewayServiceStatus[]> {
    return this.#services.list();
  }

  async status(): Promise<GatewayStatus> {
    return {
      runtime: this.runtime,
      services: await this.listServices(),
      processes: this.#mailboxes.size(),
      workerProcesses: [],
      tables: await this.tableNames(),
      serviceTasks: [],
      jobsPending: this.#jobs.count('pending'),
      jobsRunning: this.#jobs.count('running'),
      activeLeases: this.#jobs.activeLeases(),
      queueDepths: this.#jobs.queueDepths(),
      recentLogs: this.#logs.slice(-5),
      recentFailures: this.#logs
        .filter((log) => log.level === 'error' || log.level === 'warn')
        .slice(-5),
      uptimeMs: 0,
    };
  }

  async registerCapability(capability: string, actor: ActorId): Promise<void> {
    this.#capabilities.register(capability, actor);
  }

  async whereisCapability(capability: string): Promise<ActorId[]> {
    return this.#capabilities.whereis(capability);
  }

  async registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return this.#capabilities.snapshot();
  }

  async createTable(
    name: string,
    owner: ActorId,
    access: GatewayTableAccess = 'protected',
  ): Promise<boolean> {
    return this.#tables.create(name, owner, access);
  }

  async tableNames(): Promise<string[]> {
    return this.#tables.names();
  }

  async tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined> {
    return this.#tables.snapshot(name);
  }

  async enqueueJob(spec: GatewayJobSpec, id = inlineId('job')): Promise<GatewayJobStatus> {
    return this.#jobs.enqueue(spec, id);
  }

  async listJobs(): Promise<GatewayJobStatus[]> {
    return this.#jobs.list();
  }

  async showJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#jobs.show(id);
  }

  async cancelJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#jobs.cancel(id);
  }

  async acquireJob(
    queue: string,
    worker: string,
    leaseMs = 300_000,
  ): Promise<GatewayJobLease | undefined> {
    return this.#jobs.acquire(queue, worker, leaseMs);
  }

  async completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined> {
    return this.#jobs.complete(id, result);
  }

  async failJob(id: string, error: string): Promise<GatewayJobStatus | undefined> {
    return this.#jobs.fail(id, error);
  }

  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord> {
    const now = Date.now();
    const event: GatewayEventRecord = {
      id: input.id ?? inlineId('event'),
      kind: input.kind,
      target: input.target,
      state: 'pending',
      payload: input.payload ?? {},
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.#events.set(event.id, event);
    this.#log('info', event.id, 'event appended', { kind: event.kind });
    return event;
  }

  async listEvents(): Promise<GatewayEventRecord[]> {
    return [...this.#events.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  async cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return this.#cancel(this.#events, id, 'event cancelled');
  }

  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    const logs = options.target
      ? this.#logs.filter((log) => log.target === options.target)
      : this.#logs;
    return logs.slice(-(options.limit ?? 20));
  }

  #cancel<T extends { id: string; state: string; updatedAtMs: number }>(
    records: Map<string, T>,
    id: string,
    message: string,
  ): T | undefined {
    const record = records.get(id);
    if (!record) return undefined;
    record.state = 'cancelled' as T['state'];
    record.updatedAtMs = Date.now();
    this.#log('warn', id, message);
    return record;
  }

  #log(level: string, target: string | undefined, message: string, data?: unknown): void {
    this.#logs.push({
      id: this.#logs.length + 1,
      atMs: Date.now(),
      level,
      target,
      message,
      data,
    });
  }
}

function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
