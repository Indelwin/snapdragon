import type {
  GatewayAgentRuntimeDescriptor,
  GatewayJobStatus,
  GatewayLogRecord,
  GatewayQueueDepth,
  GatewaySandboxLease,
  GatewayServiceStatus,
  GatewayWorkerProcess,
  GatewayWorkerRecord,
  GatewayWorldSnapshot,
} from '@snapdragon-ai/gateway';

export function formatInspectQueueDepths(depths: GatewayQueueDepth[]): string {
  if (depths.length === 0) return 'none';
  return depths.map((depth) => `${depth.queue} p=${depth.pending} r=${depth.running}`).join(', ');
}

export function formatInspectJob(job: GatewayJobStatus): string {
  const suffixes = [
    payloadString(job, 'targetRuntimeId', ' runtime='),
    payloadString(job, 'parentJobId', ' parent='),
    payloadString(job, 'correlationId', ' correlation='),
    suffix(' lease=', job.leaseId),
    suffix(' error=', job.lastError),
  ];
  return `${job.id}\t${job.state}\t${job.spec.kind}\tqueue=${job.spec.queue} attempts=${job.attempts}${suffixes.join('')}`;
}

export function formatInspectWorker(worker: GatewayWorkerRecord): string {
  const suffixes = [
    suffix(' service=', worker.service),
    suffix(' runtime=', worker.runtimeId),
    suffix(' job=', worker.currentJobId),
    suffix(' lease=', worker.currentLeaseId),
    suffix(' status=', worker.status),
    suffix(' error=', worker.lastError),
  ];
  return `${worker.id}\t${worker.state}\tqueue=${worker.queue}${suffixes.join('')}`;
}

export function formatInspectWorkerProcess(worker: GatewayWorkerProcess): string {
  const suffixes = [
    numberSuffix(' pid=', worker.pid),
    suffix(' command=', worker.command),
    suffix(' error=', worker.lastError),
  ];
  return `${worker.id}\t${worker.state}\tservice=${worker.service}${suffixes.join('')}`;
}

export function formatInspectRuntime(runtime: GatewayAgentRuntimeDescriptor): string {
  const suffixes = [
    suffix(' ', runtime.label),
    listSuffix(' jobs=', runtime.supportedJobKinds),
    listSuffix(' caps=', runtime.capabilities),
    suffix(' health=', runtime.health?.state),
  ];
  return `${runtime.id}\t${runtime.kind}\t${runtime.protocol}${suffixes.join('')}`;
}

export function formatInspectService(service: GatewayServiceStatus): string {
  const suffixes = [
    dateSuffix(' next=', service.nextRunAtMs),
    suffix(' summary=', service.lastSummary),
    suffix(' error=', service.lastError),
  ];
  return `${service.name}\t${service.state}\tenabled=${service.enabled} runs=${service.runs} errors=${service.errors}${suffixes.join('')}`;
}

export function formatInspectLease(lease: GatewayWorldSnapshot['leases'][number]): string {
  return `${lease.id}\tjob=${lease.jobId}\tworker=${lease.worker}\texpires=${new Date(lease.expiresAtMs).toISOString()}`;
}

export function formatInspectSandbox(lease: GatewaySandboxLease): string {
  const suffixes = [
    suffix(' backend=', lease.backend),
    countSuffix(' refs=', lease.referenceRoots),
    dateSuffix(' expires=', lease.expiresAtMs),
  ];
  return `${lease.id}\t${lease.sandboxId}\t${lease.cwd}${suffixes.join('')}`;
}

export function formatInspectLog(log: GatewayLogRecord): string {
  const target = suffix('\t', log.target);
  return `${new Date(log.atMs).toISOString()}\t${log.level}${target}\t${log.message}`;
}

function payloadString(job: GatewayJobStatus, key: string, prefix: string): string {
  const payload = job.spec.payload;
  if (!payload || typeof payload !== 'object') return '';
  const value = (payload as Record<string, unknown>)[key];
  return suffix(prefix, typeof value === 'string' ? value : undefined);
}

function suffix(prefix: string, value: string | undefined): string {
  if (!value) return '';
  return `${prefix}${value}`;
}

function numberSuffix(prefix: string, value: number | undefined): string {
  if (value === undefined) return '';
  return `${prefix}${value}`;
}

function dateSuffix(prefix: string, value: number | undefined): string {
  if (value === undefined) return '';
  return `${prefix}${new Date(value).toISOString()}`;
}

function listSuffix(prefix: string, values: string[] | undefined): string {
  if (!values?.length) return '';
  return `${prefix}${values.join(',')}`;
}

function countSuffix(prefix: string, values: unknown[] | undefined): string {
  if (!values?.length) return '';
  return `${prefix}${values.length}`;
}
