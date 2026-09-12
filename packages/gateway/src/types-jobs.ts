export type GatewayJobState = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface GatewayJobSpec {
  kind: string;
  queue?: string;
  payload?: unknown;
  priority?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface GatewayJobStatus {
  id: string;
  spec: Required<Omit<GatewayJobSpec, 'timeoutMs'>> & Pick<GatewayJobSpec, 'timeoutMs'>;
  state: GatewayJobState;
  attempts: number;
  createdAtMs: number;
  updatedAtMs: number;
  leaseId?: string;
  leaseAttempt?: number;
  leaseExpiresAtMs?: number;
  lastError?: string;
  result?: unknown;
}

export interface GatewayLease {
  id: string;
  jobId: string;
  worker: string;
  attempt: number;
  acquiredAtMs: number;
  expiresAtMs: number;
}

export interface GatewayQueueDepth {
  queue: string;
  pending: number;
  running: number;
}

export interface GatewayJobLease {
  job: GatewayJobStatus;
  lease: GatewayLease;
}

export interface GatewayLeaseFence {
  leaseId: string;
  attempt: number;
}
