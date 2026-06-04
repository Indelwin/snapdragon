import type {
  GatewayEventState,
  GatewayJobState,
  GatewayServiceState,
  GatewayWorkerState,
} from './types.js';
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

const jobStates = new Set<GatewayJobState>([
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
const eventStates = new Set<GatewayEventState>([
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
]);
const serviceStates = new Set<GatewayServiceState>(['starting', 'running', 'stopped', 'failed']);
const workerStates = new Set<GatewayWorkerState>(['idle', 'running', 'offline']);

export function worldSnapshotOptionsFromSearch(
  searchParams: URLSearchParams,
): GatewayWorldSnapshotOptions {
  return {
    sections: parseSections(searchParams),
    target: first(searchParams, 'target', 'job', 'jobId', 'id'),
    queue: first(searchParams, 'queue'),
    runtimeId: first(searchParams, 'runtime', 'runtimeId'),
    service: first(searchParams, 'service', 'serviceName'),
    serviceEnabled: parseBoolean(first(searchParams, 'enabled')),
    serviceState: parseState(
      first(searchParams, 'serviceState', 'serviceStatus', 'state'),
      serviceStates,
    ),
    worker: first(searchParams, 'worker', 'workerId'),
    workerState: parseState(
      first(searchParams, 'workerState', 'workerStatus', 'state'),
      workerStates,
    ),
    capability: first(searchParams, 'capability'),
    jobKind: first(searchParams, 'kind', 'jobKind'),
    jobState: parseState(first(searchParams, 'state', 'jobState'), jobStates),
    eventKind: first(searchParams, 'eventKind'),
    eventState: parseState(first(searchParams, 'eventState', 'state'), eventStates),
    logLimit: parsePositiveInt(first(searchParams, 'limit', 'logLimit')),
    tables: parseCsv(searchParams, 'table', 'tables'),
  };
}

function parseSections(searchParams: URLSearchParams): GatewayWorldSnapshotSection[] | undefined {
  const sections = parseCsv(searchParams, 'section', 'sections').filter(
    (section): section is GatewayWorldSnapshotSection =>
      worldSections.has(section as GatewayWorldSnapshotSection),
  );
  return sections.length ? sections : undefined;
}

function parseCsv(searchParams: URLSearchParams, ...keys: string[]): string[] {
  return keys.flatMap((key) =>
    searchParams
      .getAll(key)
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

function first(searchParams: URLSearchParams, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = searchParams.get(key)?.trim();
    if (value) return value;
  }
  return undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return undefined;
}

function parseState<State extends string>(
  value: string | undefined,
  allowed: Set<State>,
): State | undefined {
  if (!value) return undefined;
  return allowed.has(value as State) ? (value as State) : undefined;
}

function parsePositiveInt(value: string | undefined): number | undefined {
  const parsed = value ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
