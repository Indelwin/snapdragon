import {
  filterAgentRuntimes,
  filterEvents,
  filterJobs,
  filterLeases,
  filterLogs,
  filterQueueDepths,
  filterServices,
  filterWorkerProcesses,
} from './query-filters.js';
import type { GatewayClient, GatewayRegistrySnapshot, GatewayTableSnapshot } from './types.js';
import type {
  GatewayWorldSnapshot,
  GatewayWorldSnapshotOptions,
  GatewayWorldSnapshotSection,
} from './types-runtime.js';

const allSections: GatewayWorldSnapshotSection[] = [
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
];

export async function buildGatewayWorldSnapshot(
  client: GatewayClient,
  options: GatewayWorldSnapshotOptions = {},
): Promise<GatewayWorldSnapshot> {
  const status = await client.status();
  const sections = sectionSet(options.sections);
  const [registry, services, agentRuntimes, jobs, events, logs] = await Promise.all([
    whenSection(sections, 'registry', () => client.registrySnapshot(), emptyRegistry()),
    whenSection(sections, 'services', () => client.listServices(), []),
    whenSection(sections, 'agentRuntimes', () => client.listAgentRuntimes(), []),
    whenSection(sections, 'jobs', () => client.listJobs(), []),
    whenSection(sections, 'events', () => client.listEvents(), []),
    whenSection(sections, 'logs', () => client.tailLogs(logOptions(options)), []),
  ]);
  const workerProcesses = selectedWorkerProcesses(sections, status.workerProcesses ?? [], options);
  const tables = sections.has('tables')
    ? await tableSnapshots(client, tableNames(status.tables, options.tables))
    : [];
  return {
    capturedAtMs: Date.now(),
    runtime: status.runtime,
    status,
    services: filterServices(services, options),
    agentRuntimes: filterAgentRuntimes(agentRuntimes, options),
    workers: sections.has('workers') ? workerProcesses : [],
    workerProcesses,
    jobs: filterJobs(jobs, options),
    events: filterEvents(events, options),
    logs: filterLogs(logs, options),
    registry,
    leases: sections.has('leases') ? filterLeases(status.activeLeases ?? [], options) : [],
    queueDepths: sections.has('queueDepths')
      ? filterQueueDepths(status.queueDepths ?? [], options)
      : [],
    tables,
    sandboxes: [],
  };
}

function sectionSet(sections: GatewayWorldSnapshotSection[] | undefined) {
  return new Set(sections?.length ? sections : allSections);
}

async function whenSection<T>(
  sections: Set<GatewayWorldSnapshotSection>,
  section: GatewayWorldSnapshotSection,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  return sections.has(section) ? load() : fallback;
}

function emptyRegistry(): GatewayRegistrySnapshot {
  return { names: {}, capabilities: {}, channels: {} };
}

function logOptions(options: GatewayWorldSnapshotOptions): { target?: string; limit?: number } {
  return { target: options.target, limit: options.logLimit ?? 50 };
}

function tableNames(allNames: string[], requested: string[] | undefined): string[] {
  return requested?.length ? allNames.filter((name) => requested.includes(name)) : allNames;
}

function selectedWorkerProcesses(
  sections: Set<GatewayWorldSnapshotSection>,
  processes: NonNullable<GatewayWorldSnapshot['workerProcesses']>,
  options: GatewayWorldSnapshotOptions,
): NonNullable<GatewayWorldSnapshot['workerProcesses']> {
  return sections.has('workerProcesses') || sections.has('workers')
    ? filterWorkerProcesses(processes, options)
    : [];
}

async function tableSnapshots(
  client: GatewayClient,
  names: string[],
): Promise<GatewayTableSnapshot[]> {
  const snapshots = await Promise.all(names.map((name) => client.tableSnapshot(name)));
  return snapshots.filter((snapshot): snapshot is GatewayTableSnapshot => snapshot !== undefined);
}
