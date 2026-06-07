export type GatewayWorkerProcessState = 'running' | 'exited' | 'timed_out' | 'failed';
export type GatewayWorkerState = 'idle' | 'running' | 'offline';

export interface GatewayWorkerProcess {
  id: string;
  service: string;
  pid?: number;
  command: string;
  args: string[];
  cwd?: string;
  startedAtMs: number;
  finishedAtMs?: number;
  timeoutMs?: number;
  state: GatewayWorkerProcessState;
  exitCode?: number;
  signal?: string;
  lastError?: string;
}

export interface GatewayWorkerRegistration {
  id: string;
  queue?: string;
  runtimeId?: string;
  service?: string;
  capabilities?: string[];
  status?: string;
  metadata?: unknown;
}

export interface GatewayWorkerHeartbeat {
  id: string;
  state?: GatewayWorkerState;
  queue?: string;
  status?: string;
  lastError?: string;
  metadata?: unknown;
}

export interface GatewayWorkerRecord {
  id: string;
  queue: string;
  runtimeId?: string;
  service?: string;
  capabilities: string[];
  state: GatewayWorkerState;
  registeredAtMs: number;
  heartbeatAtMs: number;
  currentJobId?: string;
  currentLeaseId?: string;
  leaseExpiresAtMs?: number;
  status?: string;
  lastError?: string;
  metadata?: unknown;
}
