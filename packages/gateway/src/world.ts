import type { GatewayClient, GatewayTableSnapshot } from './types.js';
import type { GatewayWorldSnapshot } from './types-runtime.js';

export async function buildGatewayWorldSnapshot(
  client: GatewayClient,
): Promise<GatewayWorldSnapshot> {
  const [status, registry, services, agentRuntimes, jobs, events, logs] = await Promise.all([
    client.status(),
    client.registrySnapshot(),
    client.listServices(),
    client.listAgentRuntimes(),
    client.listJobs(),
    client.listEvents(),
    client.tailLogs({ limit: 50 }),
  ]);
  const tables = await tableSnapshots(client, status.tables);
  return {
    capturedAtMs: Date.now(),
    runtime: status.runtime,
    status,
    services,
    agentRuntimes,
    workers: await client.listWorkers(),
    workerProcesses: status.workerProcesses ?? [],
    jobs,
    events,
    logs,
    registry,
    leases: status.activeLeases ?? [],
    queueDepths: status.queueDepths ?? [],
    tables,
    sandboxes: [],
  };
}

async function tableSnapshots(
  client: GatewayClient,
  names: string[],
): Promise<GatewayTableSnapshot[]> {
  const snapshots = await Promise.all(names.map((name) => client.tableSnapshot(name)));
  return snapshots.filter((snapshot): snapshot is GatewayTableSnapshot => snapshot !== undefined);
}
