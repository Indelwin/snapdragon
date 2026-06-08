import type {
  GatewayClient,
  GatewayWorkerRecord,
  GatewayWorkerState,
} from '@snapdragon-ai/gateway';

export interface GatewayJobWorkerRegistrationInput {
  id: string;
  service: string;
  queue: string;
  capabilities: string[];
  status: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayJobWorkerHeartbeatInput {
  id?: string;
  state: GatewayWorkerState;
  status: string;
  lastError?: string;
  metadata?: Record<string, unknown>;
}

export function gatewayJobWorkerId(service: string, pid = process.pid): string {
  return `${service}-${pid}`;
}

export async function registerGatewayJobWorker(
  client: GatewayClient,
  input: GatewayJobWorkerRegistrationInput,
): Promise<GatewayWorkerRecord> {
  return client.registerWorker({
    id: input.id,
    queue: input.queue,
    service: input.service,
    capabilities: input.capabilities,
    status: input.status,
    metadata: input.metadata,
  });
}

export async function heartbeatGatewayJobWorker(
  client: GatewayClient,
  input: GatewayJobWorkerHeartbeatInput,
): Promise<GatewayWorkerRecord | undefined> {
  if (!input.id) return undefined;
  return client.heartbeatWorker({
    id: input.id,
    state: input.state,
    status: input.status,
    lastError: input.lastError,
    metadata: input.metadata,
  });
}
