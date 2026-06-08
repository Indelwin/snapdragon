import type {
  GatewayAgentRuntimeDescriptor,
  GatewayEventRecord,
  GatewayJobStatus,
  GatewayLease,
  GatewayLogRecord,
  GatewayQueueDepth,
  GatewayServiceStatus,
  GatewayWorkerProcess,
  GatewayWorkerRecord,
} from './types.js';
import type { GatewayWorldSnapshotOptions } from './types-runtime.js';

type Predicate<T> = (item: T) => boolean;

export function filterServices(
  services: GatewayServiceStatus[],
  options: GatewayWorldSnapshotOptions,
): GatewayServiceStatus[] {
  return services.filter(
    all(
      by(options.service, (service) => service.name),
      by(options.serviceState, (service) => service.state),
      by(options.serviceEnabled, (service) => service.enabled),
    ),
  );
}

export function filterAgentRuntimes(
  runtimes: GatewayAgentRuntimeDescriptor[],
  options: GatewayWorldSnapshotOptions,
): GatewayAgentRuntimeDescriptor[] {
  return runtimes.filter(
    all(
      by(options.runtimeId, (runtime) => runtime.id),
      includes(options.capability, (runtime) => runtime.capabilities ?? []),
    ),
  );
}

export function filterWorkerProcesses(
  processes: GatewayWorkerProcess[],
  options: GatewayWorldSnapshotOptions,
): GatewayWorkerProcess[] {
  return processes.filter(
    all(
      by(options.worker, (process) => process.id),
      by(options.service, (process) => process.service),
      by(options.workerState, (process) => process.state),
    ),
  );
}

export function filterWorkers(
  workers: GatewayWorkerRecord[],
  options: GatewayWorldSnapshotOptions,
): GatewayWorkerRecord[] {
  return workers.filter(
    all(
      by(options.worker, (worker) => worker.id),
      by(options.queue, (worker) => worker.queue),
      by(options.runtimeId, (worker) => worker.runtimeId),
      by(options.service, (worker) => worker.service),
      by(options.workerState, (worker) => worker.state),
      includes(options.capability, (worker) => worker.capabilities),
    ),
  );
}

export function filterJobs(
  jobs: GatewayJobStatus[],
  options: GatewayWorldSnapshotOptions,
): GatewayJobStatus[] {
  return jobs.filter(
    all(
      by(options.target, (job) => job.id),
      by(options.queue, (job) => job.spec.queue),
      by(options.jobKind, (job) => job.spec.kind),
      by(options.jobState, (job) => job.state),
    ),
  );
}

export function filterEvents(
  events: GatewayEventRecord[],
  options: GatewayWorldSnapshotOptions,
): GatewayEventRecord[] {
  return events.filter(
    all(
      by(options.target, (event) => event.target ?? event.id),
      by(options.eventKind, (event) => event.kind),
      by(options.eventState, (event) => event.state),
    ),
  );
}

export function filterLogs(
  logs: GatewayLogRecord[],
  options: GatewayWorldSnapshotOptions,
): GatewayLogRecord[] {
  return logs.filter(by(options.target, (log) => log.target)).slice(-(options.logLimit ?? 50));
}

export function filterLeases(
  leases: GatewayLease[],
  options: GatewayWorldSnapshotOptions,
): GatewayLease[] {
  return leases.filter(
    all(
      by(options.target, (lease) => lease.jobId),
      by(options.worker, (lease) => lease.worker),
    ),
  );
}

export function filterQueueDepths(
  depths: GatewayQueueDepth[],
  options: GatewayWorldSnapshotOptions,
): GatewayQueueDepth[] {
  return depths.filter(by(options.queue, (depth) => depth.queue));
}

function all<T>(...predicates: Predicate<T>[]): Predicate<T> {
  return (item) => predicates.every((predicate) => predicate(item));
}

function by<T, Value>(
  expected: Value | undefined,
  select: (item: T) => Value | undefined,
): Predicate<T> {
  return (item) => expected === undefined || select(item) === expected;
}

function includes<T>(expected: string | undefined, select: (item: T) => string[]): Predicate<T> {
  return (item) => expected === undefined || select(item).includes(expected);
}
