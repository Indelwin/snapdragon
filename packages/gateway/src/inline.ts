import { InlineAgentRuntimeStore } from './inline-agent-runtimes.js';
import { InlineEventStore } from './inline-events.js';
import { inlineId } from './inline-job-helpers.js';
import { InlineJobStore } from './inline-jobs.js';
import { InlineMailboxStore } from './inline-mailboxes.js';
import { InlineCapabilityRegistry } from './inline-registry.js';
import { InlineSandboxStore } from './inline-sandboxes.js';
import { InlineServiceStore } from './inline-services.js';
import { InlineTableStore } from './inline-tables.js';
import { InlineWorkerStore } from './inline-workers.js';
import type * as T from './types.js';
import type {
  GatewayOrchestrationClient,
  GatewayWorldSnapshot,
  GatewayWorldSnapshotOptions,
} from './types-runtime.js';
import { buildGatewayWorldSnapshot } from './world.js';

export class InlineGatewayClient implements GatewayOrchestrationClient {
  readonly runtime = 'inline-ts' as const;
  #mailboxes = new InlineMailboxStore();
  #services = new InlineServiceStore();
  #capabilities = new InlineCapabilityRegistry();
  #tables = new InlineTableStore();
  #storeLog = (level: string, target: string | undefined, message: string, data?: unknown) =>
    this.#log(level, target, message, data);
  #agentRuntimes = new InlineAgentRuntimeStore(this.#storeLog);
  #jobs = new InlineJobStore({ log: this.#storeLog });
  #sandboxes = new InlineSandboxStore(this.#storeLog);
  #workers = new InlineWorkerStore(this.#storeLog);
  #events = new InlineEventStore(this.#storeLog);
  #logs: T.GatewayLogRecord[] = [];
  async send(envelope: T.GatewayEnvelope): Promise<void> {
    this.#mailboxes.send(envelope);
  }

  async receive(actor: T.ActorId, filter: T.GatewayReceiveFilter = {}) {
    return this.#mailboxes.receive(actor, filter);
  }

  async registerService(spec: T.GatewayServiceSpec, runner?: T.GatewayServiceRunner) {
    this.#services.register(spec, runner);
  }

  async enableService(name: string, enabled: boolean): Promise<void> {
    this.#services.enable(name, enabled);
  }

  async runService(name: string, signal?: AbortSignal) {
    return this.#services.run(name, signal);
  }

  async listServices(): Promise<T.GatewayServiceStatus[]> {
    return this.#services.list();
  }

  async status(): Promise<T.GatewayStatus> {
    return {
      runtime: this.runtime,
      services: await this.listServices(),
      agentRuntimes: await this.listAgentRuntimes(),
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

  async registerCapability(capability: string, actor: T.ActorId): Promise<void> {
    this.#capabilities.register(capability, actor);
  }

  async whereisCapability(capability: string): Promise<T.ActorId[]> {
    return this.#capabilities.whereis(capability);
  }
  async registrySnapshot(): Promise<T.GatewayRegistrySnapshot> {
    return this.#capabilities.snapshot();
  }

  async registerAgentRuntime(
    descriptor: T.GatewayAgentRuntimeDescriptor,
  ): Promise<T.GatewayAgentRuntimeDescriptor> {
    return this.#agentRuntimes.register(descriptor);
  }

  async listAgentRuntimes(): Promise<T.GatewayAgentRuntimeDescriptor[]> {
    return this.#agentRuntimes.list();
  }
  async showAgentRuntime(id: string): Promise<T.GatewayAgentRuntimeDescriptor | undefined> {
    return this.#agentRuntimes.show(id);
  }

  async unregisterAgentRuntime(id: string): Promise<T.GatewayAgentRuntimeDescriptor | undefined> {
    return this.#agentRuntimes.unregister(id);
  }

  async registerWorker(worker: T.GatewayWorkerRegistration): Promise<T.GatewayWorkerRecord> {
    return this.#workers.register(worker);
  }

  async heartbeatWorker(
    heartbeat: T.GatewayWorkerHeartbeat,
  ): Promise<T.GatewayWorkerRecord | undefined> {
    return this.#workers.heartbeat(heartbeat);
  }

  async listWorkers(): Promise<T.GatewayWorkerRecord[]> {
    return this.#workers.list();
  }
  async showWorker(id: string): Promise<T.GatewayWorkerRecord | undefined> {
    return this.#workers.show(id);
  }

  async unregisterWorker(id: string): Promise<T.GatewayWorkerRecord | undefined> {
    return this.#workers.unregister(id);
  }

  async createTable(
    name: string,
    owner: T.ActorId,
    access: T.GatewayTableAccess = 'protected',
  ): Promise<boolean> {
    return this.#tables.create(name, owner, access);
  }

  async tableNames(): Promise<string[]> {
    return this.#tables.names();
  }
  async tableSnapshot(name: string): Promise<T.GatewayTableSnapshot | undefined> {
    return this.#tables.snapshot(name);
  }

  async enqueueJob(spec: T.GatewayJobSpec, id = inlineId('job')): Promise<T.GatewayJobStatus> {
    return this.#jobs.enqueue(spec, id);
  }

  async listJobs(): Promise<T.GatewayJobStatus[]> {
    return this.#jobs.list();
  }

  async showJob(id: string): Promise<T.GatewayJobStatus | undefined> {
    return this.#jobs.show(id);
  }

  async cancelJob(id: string): Promise<T.GatewayJobStatus | undefined> {
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.cancel(id);
    this.#workers.clearLease(lease);
    return job;
  }

  async retryJob(id: string): Promise<T.GatewayJobStatus | undefined> {
    return this.#jobs.retry(id);
  }

  async acquireJob(
    queue: string,
    worker: string,
    leaseMs = 300_000,
  ): Promise<T.GatewayJobLease | undefined> {
    const acquired = this.#jobs.acquire(queue, worker, leaseMs);
    if (acquired) this.#workers.markLeased(worker, queue, acquired.lease);
    return acquired;
  }

  async completeJob(id: string, result?: unknown): Promise<T.GatewayJobStatus | undefined> {
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.complete(id, result);
    this.#workers.clearLease(lease);
    return job;
  }

  async failJob(id: string, error: string): Promise<T.GatewayJobStatus | undefined> {
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.fail(id, error);
    this.#workers.clearLease(lease);
    return job;
  }

  async leaseSandbox(spec: T.GatewaySandboxSpec): Promise<T.GatewaySandboxLease> {
    return this.#sandboxes.lease(spec);
  }

  async listSandboxLeases(): Promise<T.GatewaySandboxLease[]> {
    return this.#sandboxes.list();
  }

  async showSandboxLease(id: string): Promise<T.GatewaySandboxLease | undefined> {
    return this.#sandboxes.show(id);
  }

  async releaseSandbox(id: string): Promise<T.GatewaySandboxLease | undefined> {
    return this.#sandboxes.release(id);
  }

  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<T.GatewayEventRecord> {
    return this.#events.append(input);
  }

  async listEvents(): Promise<T.GatewayEventRecord[]> {
    return this.#events.list();
  }

  async cancelEvent(id: string): Promise<T.GatewayEventRecord | undefined> {
    return this.#events.cancel(id);
  }

  #log(
    level: string,
    target: string | undefined,
    message: string,
    data?: unknown,
    atMs = Date.now(),
  ): T.GatewayLogRecord {
    const record = {
      id: this.#logs.length + 1,
      atMs,
      level,
      target,
      message,
      data,
    };
    this.#logs.push(record);
    return record;
  }

  async appendLog(input: T.GatewayLogInput): Promise<T.GatewayLogRecord> {
    return this.#log(input.level ?? 'info', input.target, input.message, input.data, input.atMs);
  }

  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<T.GatewayLogRecord[]> {
    const logs = options.target
      ? this.#logs.filter((log) => log.target === options.target)
      : this.#logs;
    return logs.slice(-(options.limit ?? 20));
  }

  async worldSnapshot(options?: GatewayWorldSnapshotOptions): Promise<GatewayWorldSnapshot> {
    return buildGatewayWorldSnapshot(this, options);
  }

  #leaseForJob(id: string) {
    return this.#jobs.activeLeases().find((lease) => lease.jobId === id);
  }
}
