import type {
  GatewayEventRecord,
  GatewayEventState,
  GatewayJobLease,
  GatewayJobSpec,
  GatewayJobState,
  GatewayJobStatus,
  GatewayLease,
  GatewayLogRecord,
} from './types.js';

interface WireJobStatus {
  id: string;
  spec: {
    kind: string;
    queue: string;
    payload: unknown;
    priority: number;
    max_attempts: number;
    timeout_ms?: number | null;
  };
  state: string;
  attempts: number;
  created_at_ms: number;
  updated_at_ms: number;
  lease_id?: string | null;
  lease_expires_at_ms?: number | null;
  last_error?: string | null;
  result?: unknown;
}

interface WireEventRecord {
  id: string;
  kind: string;
  target?: string | null;
  state: string;
  payload?: unknown;
  created_at_ms: number;
  updated_at_ms: number;
}

interface WireLogRecord {
  id: number;
  at_ms: number;
  level: string;
  target?: string | null;
  message: string;
  data?: unknown;
}

interface WireLease {
  id: string;
  job_id: string;
  worker: string;
  acquired_at_ms: number;
  expires_at_ms: number;
}

interface WireJobLease {
  job?: WireJobStatus;
  lease?: WireLease;
}

export function toWireJobSpec(spec: GatewayJobSpec): Record<string, unknown> {
  return {
    kind: spec.kind,
    queue: spec.queue ?? 'default',
    payload: spec.payload ?? {},
    priority: spec.priority ?? 0,
    max_attempts: spec.maxAttempts ?? 1,
    timeout_ms: spec.timeoutMs ?? null,
  };
}

export function fromWireJobStatus(value: WireJobStatus | undefined): GatewayJobStatus | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    spec: {
      kind: value.spec.kind,
      queue: value.spec.queue,
      payload: value.spec.payload,
      priority: Number(value.spec.priority ?? 0),
      maxAttempts: Number(value.spec.max_attempts ?? 1),
      timeoutMs: value.spec.timeout_ms ?? undefined,
    },
    state: fromWireJobState(value.state),
    attempts: Number(value.attempts ?? 0),
    createdAtMs: Number(value.created_at_ms ?? 0),
    updatedAtMs: Number(value.updated_at_ms ?? 0),
    leaseId: value.lease_id ?? undefined,
    leaseExpiresAtMs: value.lease_expires_at_ms ?? undefined,
    lastError: value.last_error ?? undefined,
    result: value.result,
  };
}

export function fromWireJobLease(value: WireJobLease | undefined): GatewayJobLease | undefined {
  const job = fromWireJobStatus(value?.job);
  if (!job || !value?.lease) return undefined;
  return { job, lease: fromWireLease(value.lease) };
}

export function fromWireLease(value: WireLease): GatewayLease {
  return {
    id: value.id,
    jobId: value.job_id,
    worker: value.worker,
    acquiredAtMs: Number(value.acquired_at_ms ?? 0),
    expiresAtMs: Number(value.expires_at_ms ?? 0),
  };
}

export function fromWireEventRecord(
  value: WireEventRecord | undefined,
): GatewayEventRecord | undefined {
  if (!value) return undefined;
  return {
    id: value.id,
    kind: value.kind,
    target: value.target ?? undefined,
    state: fromWireEventState(value.state),
    payload: value.payload,
    createdAtMs: Number(value.created_at_ms ?? 0),
    updatedAtMs: Number(value.updated_at_ms ?? 0),
  };
}

export function fromWireLogRecord(value: unknown): GatewayLogRecord {
  const record = value as WireLogRecord;
  return {
    id: Number(record.id),
    atMs: Number(record.at_ms ?? 0),
    level: record.level,
    target: record.target ?? undefined,
    message: record.message,
    data: record.data,
  };
}

function fromWireJobState(value: string): GatewayJobState {
  const normalized = normalizeEnum(value);
  if (normalized === 'running') return 'running';
  if (normalized === 'completed') return 'completed';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

function fromWireEventState(value: string): GatewayEventState {
  const normalized = normalizeEnum(value);
  if (normalized === 'running') return 'running';
  if (normalized === 'done') return 'done';
  if (normalized === 'failed') return 'failed';
  if (normalized === 'cancelled') return 'cancelled';
  return 'pending';
}

function normalizeEnum(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}
