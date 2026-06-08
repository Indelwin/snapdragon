import { normalizeAgentRuntime } from './inline-agent-runtimes.js';
import { InlineEventStore } from './inline-events.js';
import { InlineJobStore } from './inline-jobs.js';
import { InlineLogStore } from './inline-logs.js';
import { InlineMailboxStore } from './inline-mailboxes.js';
import { InlineCapabilityRegistry } from './inline-registry.js';
import { InlineSandboxStore } from './inline-sandboxes.js';
import { InlineServiceStore } from './inline-services.js';
import { InlineTableStore } from './inline-tables.js';
import { InlineWorkerStore } from './inline-workers.js';
import type {
  ActorId,
  GatewayAgentRuntimeDescriptor,
  GatewayEnvelope,
  GatewayEventRecord,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobStatus,
  GatewayLogInput,
  GatewayLogRecord,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
} from './types.js';
import type { GatewayOrchestrationClient, GatewayWorldSnapshot } from './types-runtime.js';
import type { GatewaySandboxLease } from './types-sandboxes.js';
import { buildGatewayWorldSnapshot } from './world.js';

export class InlineGatewayClient implements GatewayOrchestrationClient {
  readonly runtime = 'inline-ts' as const;
  #mailboxes = new InlineMailboxStore();
  #services = new InlineServiceStore();
  #capabilities = new InlineCapabilityRegistry();
  #agentRuntimes = new Map<string, GatewayAgentRuntimeDescriptor>();
  #tables = new InlineTableStore();
  #logs = new InlineLogStore();
  #events = new InlineEventStore((level, target, message, data) =>
    this.#log(level, target, message, data),
  );
  #workers = new InlineWorkerStore((level, target, message, data) =>
    this.#log(level, target, message, data),
  );
  #sandboxes = new InlineSandboxStore((level, target, message, data) =>
    this.#log(level, target, message, data),
  );
  #jobs = new InlineJobStore({
    log: (level, target, message, data) => this.#log(level, target, message, data),
  });

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
      agentRuntimes: await this.listAgentRuntimes(),
      workers: await this.listWorkers(),
      processes: this.#mailboxes.size(),
      workerProcesses: [],
      tables: await this.tableNames(),
      serviceTasks: [],
      jobsPending: this.#jobs.count('pending'),
      jobsRunning: this.#jobs.count('running'),
      activeLeases: this.#jobs.activeLeases(),
      queueDepths: this.#jobs.queueDepths(),
      recentLogs: this.#logs.tail({ limit: 5 }),
      recentFailures: this.#logs.failures(5),
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
  async registerAgentRuntime(
    descriptor: GatewayAgentRuntimeDescriptor,
  ): Promise<GatewayAgentRuntimeDescriptor> {
    const normalized = normalizeAgentRuntime(descriptor);
    this.#agentRuntimes.set(normalized.id, normalized);
    this.#log('info', normalized.id, 'agent runtime registered', {
      kind: normalized.kind,
      protocol: normalized.protocol,
    });
    return normalized;
  }

  async listAgentRuntimes(): Promise<GatewayAgentRuntimeDescriptor[]> {
    return [...this.#agentRuntimes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
  async showAgentRuntime(id: string): Promise<GatewayAgentRuntimeDescriptor | undefined> {
    return this.#agentRuntimes.get(id);
  }
  async registerWorker(worker: GatewayWorkerRegistration): Promise<GatewayWorkerRecord> {
    return this.#workers.register(worker);
  }
  async heartbeatWorker(
    heartbeat: GatewayWorkerHeartbeat,
  ): Promise<GatewayWorkerRecord | undefined> {
    return this.#workers.heartbeat(heartbeat);
  }

  async listWorkers(): Promise<GatewayWorkerRecord[]> {
    return this.#workers.list();
  }
  async showWorker(id: string): Promise<GatewayWorkerRecord | undefined> {
    return this.#workers.show(id);
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
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.cancel(id);
    if (job) this.#workers.clearLease(lease);
    return job;
  }
  async retryJob(id: string): Promise<GatewayJobStatus | undefined> {
    return this.#jobs.retry(id);
  }
  async acquireJob(
    queue: string,
    worker: string,
    leaseMs = 300_000,
  ): Promise<GatewayJobLease | undefined> {
    const lease = this.#jobs.acquire(queue, worker, leaseMs);
    if (lease) this.#workers.markLeased(worker, queue, lease.lease);
    return lease;
  }

  async completeJob(id: string, result?: unknown): Promise<GatewayJobStatus | undefined> {
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.complete(id, result);
    if (job) this.#workers.clearLease(lease);
    return job;
  }
  async failJob(id: string, error: string): Promise<GatewayJobStatus | undefined> {
    const lease = this.#leaseForJob(id);
    const job = this.#jobs.fail(id, error);
    if (job) this.#workers.clearLease(lease);
    return job;
  }
  async appendEvent(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): Promise<GatewayEventRecord> {
    return this.#events.append(input);
  }
  async listEvents(): Promise<GatewayEventRecord[]> {
    return this.#events.list();
  }
  async cancelEvent(id: string): Promise<GatewayEventRecord | undefined> {
    return this.#events.cancel(id);
  }
  async appendLog(input: GatewayLogInput): Promise<GatewayLogRecord> {
    return this.#logs.appendInput(input);
  }
  async tailLogs(options: { target?: string; limit?: number } = {}): Promise<GatewayLogRecord[]> {
    return this.#logs.tail(options);
  }
  async registerSandboxLease(lease: GatewaySandboxLease): Promise<GatewaySandboxLease> {
    return this.#sandboxes.register(lease);
  }
  async listSandboxLeases(): Promise<GatewaySandboxLease[]> {
    return this.#sandboxes.list();
  }
  async showSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#sandboxes.show(id);
  }
  async releaseSandboxLease(id: string): Promise<GatewaySandboxLease | undefined> {
    return this.#sandboxes.release(id);
  }
  async worldSnapshot(): Promise<GatewayWorldSnapshot> {
    return buildGatewayWorldSnapshot(this);
  }
  #log(
    level: string,
    target: string | undefined,
    message: string,
    data?: unknown,
    atMs = Date.now(),
  ): GatewayLogRecord {
    return this.#logs.append({ level, target, message, data, atMs });
  }

  #leaseForJob(id: string) {
    return this.#jobs.activeLeases().find((lease) => lease.jobId === id);
  }
}

function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
