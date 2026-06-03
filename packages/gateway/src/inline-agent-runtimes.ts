import { normalizeGatewayAgentRuntimeDescriptor } from './agent-runtime-validation.js';
import type { GatewayAgentRuntimeDescriptor } from './types.js';

type InlineAgentRuntimeLogger = (
  level: string,
  target: string | undefined,
  message: string,
  data?: unknown,
) => void;

export class InlineAgentRuntimeStore {
  #agentRuntimes = new Map<string, GatewayAgentRuntimeDescriptor>();

  constructor(private readonly log: InlineAgentRuntimeLogger) {}

  register(descriptor: GatewayAgentRuntimeDescriptor): GatewayAgentRuntimeDescriptor {
    const normalized = normalizeGatewayAgentRuntimeDescriptor(descriptor);
    this.#agentRuntimes.set(normalized.id, normalized);
    this.log('info', normalized.id, 'agent runtime registered', {
      kind: normalized.kind,
      protocol: normalized.protocol,
    });
    return normalized;
  }

  list(): GatewayAgentRuntimeDescriptor[] {
    return [...this.#agentRuntimes.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  show(id: string): GatewayAgentRuntimeDescriptor | undefined {
    return this.#agentRuntimes.get(id);
  }

  unregister(id: string): GatewayAgentRuntimeDescriptor | undefined {
    const runtime = this.#agentRuntimes.get(id);
    this.#agentRuntimes.delete(id);
    if (runtime) {
      this.log('warn', id, 'agent runtime unregistered', {
        kind: runtime.kind,
        protocol: runtime.protocol,
      });
    }
    return runtime;
  }
}
