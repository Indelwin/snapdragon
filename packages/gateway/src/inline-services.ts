import { InlineServiceLifecycles } from './inline-service-lifecycle.js';
import { executeServiceRun, type RunReservation, reserveServiceRun } from './inline-service-run.js';
import { type InlineServiceState, serviceState } from './inline-service-state.js';
import type { GatewayServiceRunner, GatewayServiceSpec, GatewayServiceStatus } from './types.js';

export class InlineServiceStore {
  #services = new Map<string, InlineServiceState>();
  #lifecycles = new InlineServiceLifecycles();
  #closed = false;

  async register(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    await this.#withLifecycle(spec.name, async () => {
      if (this.#closed) throw new Error('gateway services are closed');
      const previous = this.#services.get(spec.name);
      if (previous) {
        previous.status.enabled = false;
        previous.abort?.abort(new Error(`gateway service ${spec.name} replaced`));
        await previous.tail;
      }
      if (this.#closed) throw new Error('gateway services are closed');
      this.#services.set(spec.name, serviceState(spec, runner));
    });
  }

  async enable(name: string, enabled: boolean): Promise<void> {
    await this.#withLifecycle(name, async () => {
      if (this.#closed && enabled) throw new Error('gateway services are closed');
      const service = this.#require(name);
      service.spec = { ...service.spec, enabled };
      service.status.enabled = enabled;
      service.status.state = enabled ? 'running' : 'stopped';
      service.status.nextRunAtMs = undefined;
      service.status.restartSuppressed = false;
      if (!enabled) {
        service.abort?.abort(new Error(`gateway service ${name} disabled`));
        await service.tail;
      }
    });
  }

  async run(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined> {
    const reservation = await this.#withLifecycle<RunReservation | undefined>(name, () => {
      const service = this.#services.get(name);
      if (!service) return undefined;
      return reserveServiceRun(service, this.#closed);
    });
    if (!reservation) return undefined;
    if ('status' in reservation) return reservation.status;
    return executeServiceRun(reservation, signal);
  }

  list(): GatewayServiceStatus[] {
    return [...this.#services.values()].map((service) => ({ ...service.status }));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await Promise.all(
      [...this.#services.keys()].map((name) =>
        this.#withLifecycle(name, async () => {
          const service = this.#services.get(name);
          if (!service) return;
          service.status.enabled = false;
          service.status.state = 'stopped';
          service.abort?.abort(new Error(`gateway service ${service.spec.name} closed`));
          await service.tail;
        }),
      ),
    );
  }

  #require(name: string): InlineServiceState {
    const service = this.#services.get(name);
    if (!service) throw new Error(`Unknown gateway service: ${name}`);
    return service;
  }

  async #withLifecycle<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
    return this.#lifecycles.run(name, operation);
  }
}
