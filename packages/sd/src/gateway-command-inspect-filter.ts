import type {
  GatewayAgentRuntimeDescriptor,
  GatewayJobStatus,
  GatewayLogRecord,
  GatewaySandboxLease,
  GatewayServiceStatus,
  GatewayWorkerProcess,
  GatewayWorkerRecord,
  GatewayWorldSnapshot,
} from '@snapdragon-ai/gateway';
import { optionIncluded, optionMatches, optionOneOf } from './gateway-command-inspect-matchers.js';
import type { GatewayInspectOptions } from './gateway-command-inspect-options.js';

export function filterInspectSnapshot(
  snapshot: GatewayWorldSnapshot,
  options: GatewayInspectOptions,
): GatewayWorldSnapshot {
  return {
    ...snapshot,
    queueDepths: snapshot.queueDepths.filter((depth) => optionMatches(options.queue, depth.queue)),
    jobs: snapshot.jobs.filter((job) => jobMatches(job, options)),
    workers: snapshot.workers.filter((worker) => workerMatches(worker, options)),
    workerProcesses: snapshot.workerProcesses.filter((worker) =>
      workerProcessMatches(worker, options),
    ),
    agentRuntimes: snapshot.agentRuntimes.filter((runtime) => runtimeMatches(runtime, options)),
    services: snapshot.services.filter((service) => serviceMatches(service, options)),
    leases: snapshot.leases.filter((lease) => leaseMatches(lease, options)),
    sandboxes: snapshot.sandboxes.filter((lease) => sandboxMatches(lease, options)),
    logs: snapshot.logs.filter((log) => logMatches(log, options)).slice(-options.logLimit),
  };
}

function jobMatches(job: GatewayJobStatus, options: GatewayInspectOptions): boolean {
  return [
    optionMatches(options.target, job.id),
    optionMatches(options.queue, job.spec.queue),
    optionMatches(options.runtimeId, payloadString(job, 'targetRuntimeId')),
    optionMatches(options.jobKind, job.spec.kind),
    optionMatches(options.capability, job.spec.kind),
    optionMatches(options.jobState, job.state),
  ].every(Boolean);
}

function workerMatches(worker: GatewayWorkerRecord, options: GatewayInspectOptions): boolean {
  return [
    optionMatches(options.workerId, worker.id),
    optionMatches(options.queue, worker.queue),
    optionMatches(options.runtimeId, worker.runtimeId),
    optionMatches(options.service, worker.service),
    optionIncluded(options.capability, worker.capabilities),
  ].every(Boolean);
}

function workerProcessMatches(
  worker: GatewayWorkerProcess,
  options: GatewayInspectOptions,
): boolean {
  return [
    optionMatches(options.workerId, worker.id),
    optionMatches(options.service, worker.service),
  ].every(Boolean);
}

function runtimeMatches(
  runtime: GatewayAgentRuntimeDescriptor,
  options: GatewayInspectOptions,
): boolean {
  return [
    optionMatches(options.runtimeId, runtime.id),
    optionIncluded(options.capability, runtime.capabilities),
  ].every(Boolean);
}

function serviceMatches(service: GatewayServiceStatus, options: GatewayInspectOptions): boolean {
  return [
    optionMatches(options.service, service.name),
    optionMatches(options.serviceState, service.state),
  ].every(Boolean);
}

function leaseMatches(
  lease: GatewayWorldSnapshot['leases'][number],
  options: GatewayInspectOptions,
): boolean {
  return optionOneOf(options.target, [lease.id, lease.jobId, lease.worker]);
}

function sandboxMatches(lease: GatewaySandboxLease, options: GatewayInspectOptions): boolean {
  return optionOneOf(options.target, [lease.id, lease.sandboxId, lease.project?.id]);
}

function logMatches(log: GatewayLogRecord, options: GatewayInspectOptions): boolean {
  return optionMatches(options.target, log.target);
}

function payloadString(job: GatewayJobStatus, key: string): string | undefined {
  const payload = job.spec.payload;
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}
