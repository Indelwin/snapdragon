import {
  booleanParam,
  eventStateParam,
  jobStateParam,
  serviceStateParam,
  workerProcessStateParam,
} from './rest-query-values.js';
import type { GatewayWorldSnapshotOptions, GatewayWorldSnapshotSection } from './types-runtime.js';

const worldSections = new Set<GatewayWorldSnapshotSection>([
  'services',
  'agentRuntimes',
  'workers',
  'workerProcesses',
  'jobs',
  'events',
  'logs',
  'registry',
  'leases',
  'queueDepths',
  'tables',
  'sandboxes',
]);

export function worldSnapshotOptionsFromSearch(
  searchParams: URLSearchParams,
): GatewayWorldSnapshotOptions {
  return {
    sections: parseSections(searchParams),
    target: first(searchParams, 'target', 'job', 'jobId', 'id'),
    queue: first(searchParams, 'queue'),
    runtimeId: first(searchParams, 'runtime', 'runtimeId'),
    service: first(searchParams, 'service', 'serviceName'),
    worker: first(searchParams, 'worker', 'workerId', 'process', 'processId'),
    capability: first(searchParams, 'capability'),
    serviceEnabled: booleanParam(first(searchParams, 'enabled')),
    serviceState: serviceStateParam(first(searchParams, 'serviceState', 'serviceStatus', 'state')),
    workerState: workerProcessStateParam(
      first(searchParams, 'workerState', 'workerStatus', 'state'),
    ),
    jobKind: first(searchParams, 'kind', 'jobKind'),
    jobState: jobStateParam(first(searchParams, 'jobState', 'state')),
    eventKind: first(searchParams, 'eventKind'),
    eventState: eventStateParam(first(searchParams, 'eventState', 'state')),
    logLimit: positiveInt(first(searchParams, 'limit', 'logLimit')),
    tables: csv(searchParams, 'table', 'tables'),
  };
}

function parseSections(searchParams: URLSearchParams): GatewayWorldSnapshotSection[] | undefined {
  const sections = csv(searchParams, 'section', 'sections').filter(
    (section): section is GatewayWorldSnapshotSection =>
      worldSections.has(section as GatewayWorldSnapshotSection),
  );
  return sections.length ? sections : undefined;
}

function csv(searchParams: URLSearchParams, ...keys: string[]): string[] {
  return keys.flatMap((key) =>
    searchParams
      .getAll(key)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function first(searchParams: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
