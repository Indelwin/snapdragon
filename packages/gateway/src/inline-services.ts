import type { GatewayServiceRunner, GatewayServiceSpec, GatewayServiceStatus } from './types.js';

interface ServiceState {
  spec: GatewayServiceSpec;
  status: GatewayServiceStatus;
  runner?: GatewayServiceRunner;
}

export class InlineServiceStore {
  #services = new Map<string, ServiceState>();

  register(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): void {
    this.#services.set(spec.name, serviceState(spec, runner));
  }

  enable(name: string, enabled: boolean): void {
    const service = this.#require(name);
    service.spec = { ...service.spec, enabled };
    service.status.enabled = enabled;
    service.status.state = enabled ? 'running' : 'stopped';
    service.status.nextRunAtMs = undefined;
    service.status.restartSuppressed = false;
  }

  async run(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined> {
    const service = this.#services.get(name);
    if (!service) return undefined;
    if (!service.status.enabled) return { ...service.status };
    await runServiceState(service, signal);
    return { ...service.status };
  }

  list(): GatewayServiceStatus[] {
    return [...this.#services.values()].map((service) => ({ ...service.status }));
  }

  #require(name: string): ServiceState {
    const service = this.#services.get(name);
    if (!service) throw new Error(`Unknown gateway service: ${name}`);
    return service;
  }
}

function serviceState(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): ServiceState {
  const enabled = spec.enabled ?? true;
  return {
    spec,
    runner,
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

async function runServiceState(service: ServiceState, signal?: AbortSignal): Promise<void> {
  try {
    const result = await service.runner?.run(signal);
    service.status.runs += 1;
    service.status.consecutiveErrors = 0;
    service.status.lastRunAtMs = Date.now();
    service.status.lastSummary = result?.summary;
    service.status.state = 'running';
    service.status.lastExitReason = 'ok';
  } catch (error) {
    service.status.errors += 1;
    service.status.consecutiveErrors = (service.status.consecutiveErrors ?? 0) + 1;
    const message = error instanceof Error ? error.message : String(error);
    service.status.lastError = message;
    service.status.lastExitReason = message;
    service.status.state = 'failed';
  }
}
