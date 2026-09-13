import type { GatewayServiceRunner, GatewayServiceSpec, GatewayServiceStatus } from './types.js';

export interface InlineServiceState {
  spec: GatewayServiceSpec;
  status: GatewayServiceStatus;
  runner?: GatewayServiceRunner;
  tail: Promise<void>;
  abort?: AbortController;
}

export function serviceState(
  spec: GatewayServiceSpec,
  runner?: GatewayServiceRunner,
): InlineServiceState {
  const enabled = spec.enabled ?? true;
  return {
    spec,
    runner,
    tail: Promise.resolve(),
    status: {
      name: spec.name,
      enabled,
      state: enabled ? 'running' : 'stopped',
      runs: 0,
      errors: 0,
      consecutiveErrors: 0,
      restartSuppressed: false,
    },
  };
}

export async function runServiceState(
  service: InlineServiceState,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const result = await service.runner?.run(signal);
    service.status.runs += 1;
    service.status.consecutiveErrors = 0;
    service.status.lastRunAtMs = Date.now();
    service.status.lastSummary = result?.summary;
    service.status.state = 'running';
    service.status.lastExitReason = 'ok';
  } catch (error) {
    if (!service.status.enabled || signal?.aborted) {
      service.status.state = 'stopped';
      return;
    }
    service.status.errors += 1;
    service.status.consecutiveErrors = (service.status.consecutiveErrors ?? 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    service.status.lastError = message;
    service.status.lastExitReason = message;
    service.status.state = 'failed';
  }
}
