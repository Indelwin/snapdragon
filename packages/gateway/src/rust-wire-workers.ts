import type {
  GatewayWorkerHeartbeat,
  GatewayWorkerRecord,
  GatewayWorkerRegistration,
  GatewayWorkerState,
} from './types.js';

export interface WireWorkerRecord {
  id: string;
  queue: string;
  runtime_id?: string | null;
  service?: string | null;
  capabilities?: string[];
  state: string;
  registered_at_ms: number;
  heartbeat_at_ms: number;
  current_job_id?: string | null;
  current_lease_id?: string | null;
  lease_expires_at_ms?: number | null;
  status?: string | null;
  last_error?: string | null;
  metadata?: unknown;
}

export function toWireWorkerRegistration(
  worker: GatewayWorkerRegistration,
): Record<string, unknown> {
  return {
    id: worker.id,
    queue: worker.queue ?? null,
    runtime_id: worker.runtimeId ?? null,
    service: worker.service ?? null,
    capabilities: worker.capabilities ?? [],
    status: worker.status ?? null,
    metadata: worker.metadata,
  };
}

export function toWireWorkerHeartbeat(heartbeat: GatewayWorkerHeartbeat): Record<string, unknown> {
  return {
    id: heartbeat.id,
    state: heartbeat.state,
    queue: heartbeat.queue ?? null,
    status: heartbeat.status ?? null,
    last_error: heartbeat.lastError ?? null,
    metadata: heartbeat.metadata,
  };
}

export function fromWireWorkerRecord(
  value: WireWorkerRecord | undefined,
): GatewayWorkerRecord | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    queue: value.queue,
    runtimeId: value.runtime_id ?? undefined,
    service: value.service ?? undefined,
    capabilities: value.capabilities ?? [],
    state: fromWireWorkerState(value.state),
    registeredAtMs: Number(value.registered_at_ms ?? 0),
    heartbeatAtMs: Number(value.heartbeat_at_ms ?? 0),
    currentJobId: value.current_job_id ?? undefined,
    currentLeaseId: value.current_lease_id ?? undefined,
    leaseExpiresAtMs: value.lease_expires_at_ms ?? undefined,
    status: value.status ?? undefined,
    lastError: value.last_error ?? undefined,
    metadata: value.metadata,
  };
}

function fromWireWorkerState(value: string): GatewayWorkerState {
  const normalized = value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
  if (normalized === 'running') return 'running';
  if (normalized === 'offline') return 'offline';
  return 'idle';
}
