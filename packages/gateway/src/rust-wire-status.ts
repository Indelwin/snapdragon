import { fromWireLogRecord } from './rust-wire-durable.js';
import { fromWireAgentRuntimeDescriptor } from './rust-wire-runtime.js';
import { fromWireWorkerRecord, type WireWorkerRecord } from './rust-wire-workers.js';
import type {
  GatewayAgentRuntimeDescriptor,
  GatewayLease,
  GatewayQueueDepth,
  GatewayServiceState,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayWorkerProcess,
  GatewayWorkerProcessState,
  GatewayWorkerRecord,
} from './types.js';

interface WireServiceStatus {
  name: string;
  enabled: boolean;
  state: string;
  runs: number;
  errors: number;
  consecutive_errors?: number;
  last_run_at_ms?: number | null;
  last_error?: string | null;
  last_summary?: string | null;
  restart_suppressed?: boolean;
  next_run_at_ms?: number | null;
  last_exit_reason?: string | null;
}

interface WireStatus {
  services?: WireServiceStatus[];
  agent_runtimes?: unknown[];
  workers?: WireWorkerRecord[];
  processes?: number;
  worker_processes?: WireWorkerProcess[];
  tables?: string[];
  service_tasks?: string[];
  jobs_pending?: number;
  jobs_running?: number;
  active_leases?: WireLease[];
  queue_depths?: WireQueueDepth[];
  recent_logs?: unknown[];
  recent_failures?: unknown[];
  uptime_ms?: number;
  pid?: number;
}

interface WireWorkerProcess {
  id: string;
  service: string;
  pid?: number | null;
  command: string;
  args?: string[];
  cwd?: string | null;
  started_at_ms: number;
  finished_at_ms?: number | null;
  timeout_ms?: number | null;
  state: string;
  exit_code?: number | null;
  signal?: string | null;
  last_error?: string | null;
}

interface WireLease {
  id: string;
  job_id: string;
  worker: string;
  acquired_at_ms: number;
  expires_at_ms: number;
}

interface WireQueueDepth {
  queue: string;
  pending: number;
  running: number;
}

export function fromWireStatus(value: WireStatus): GatewayStatus {
  return {
    runtime: 'rust',
    services: (value.services ?? []).map(fromWireServiceStatus),
    agentRuntimes: (value.agent_runtimes ?? [])
      .map((runtime) => fromWireAgentRuntimeDescriptor(runtime as any))
      .filter((runtime): runtime is GatewayAgentRuntimeDescriptor => runtime !== undefined),
    workers: (value.workers ?? [])
      .map((worker) => fromWireWorkerRecord(worker))
      .filter((worker): worker is GatewayWorkerRecord => worker !== undefined),
    processes: value.processes ?? 0,
    workerProcesses: value.worker_processes?.map(fromWireWorkerProcess),
    tables: value.tables ?? [],
    serviceTasks: value.service_tasks,
    jobsPending: value.jobs_pending,
    jobsRunning: value.jobs_running,
    activeLeases: value.active_leases?.map(fromWireLease),
    queueDepths: value.queue_depths?.map(fromWireQueueDepth),
    recentLogs: value.recent_logs?.map(fromWireLogRecord),
    recentFailures: value.recent_failures?.map(fromWireLogRecord),
    uptimeMs: value.uptime_ms,
    pid: value.pid,
  };
}

export function fromWireServiceStatus(value: WireServiceStatus): GatewayServiceStatus {
  return {
    name: value.name,
    enabled: value.enabled,
    state: fromWireServiceState(value.state),
    runs: value.runs,
    errors: value.errors,
    consecutiveErrors: value.consecutive_errors,
    lastRunAtMs: value.last_run_at_ms ?? undefined,
    lastError: value.last_error ?? undefined,
    lastSummary: value.last_summary ?? undefined,
    restartSuppressed: value.restart_suppressed,
    nextRunAtMs: value.next_run_at_ms ?? undefined,
    lastExitReason: value.last_exit_reason ?? undefined,
  };
}

function fromWireWorkerProcess(value: WireWorkerProcess): GatewayWorkerProcess {
  return {
    id: value.id,
    service: value.service,
    pid: value.pid ?? undefined,
    command: value.command,
    args: value.args ?? [],
    cwd: value.cwd ?? undefined,
    startedAtMs: Number(value.started_at_ms ?? 0),
    finishedAtMs: value.finished_at_ms ?? undefined,
    timeoutMs: value.timeout_ms ?? undefined,
    state: fromWireWorkerProcessState(value.state),
    exitCode: value.exit_code ?? undefined,
    signal: value.signal ?? undefined,
    lastError: value.last_error ?? undefined,
  };
}

function fromWireWorkerProcessState(value: string): GatewayWorkerProcessState {
  const normalized = toSnakeCase(value);
  if (normalized === 'exited') return 'exited';
  if (normalized === 'timed_out') return 'timed_out';
  if (normalized === 'failed') return 'failed';
  return 'running';
}

function fromWireLease(value: WireLease): GatewayLease {
  return {
    id: value.id,
    jobId: value.job_id,
    worker: value.worker,
    acquiredAtMs: Number(value.acquired_at_ms ?? 0),
    expiresAtMs: Number(value.expires_at_ms ?? 0),
  };
}

function fromWireQueueDepth(value: WireQueueDepth): GatewayQueueDepth {
  return {
    queue: value.queue,
    pending: Number(value.pending ?? 0),
    running: Number(value.running ?? 0),
  };
}

function fromWireServiceState(value: string): GatewayServiceState {
  const normalized = toSnakeCase(value);
  if (normalized === 'starting') return 'starting';
  if (normalized === 'stopped') return 'stopped';
  if (normalized === 'failed') return 'failed';
  return 'running';
}

function toSnakeCase(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
}
