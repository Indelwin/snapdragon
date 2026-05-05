import type { ActorId, GatewayRegistrySnapshot } from './types.js';

export class InlineCapabilityRegistry {
  #capabilities = new Map<string, Set<string>>();

  register(capability: string, actor: ActorId): void {
    const actors = this.#capabilities.get(capability) ?? new Set<string>();
    actors.add(actor.id);
    this.#capabilities.set(capability, actors);
  }

  whereis(capability: string): ActorId[] {
    return [...(this.#capabilities.get(capability) ?? [])].map((id) => ({ id }));
  }

  snapshot(): GatewayRegistrySnapshot {
    return {
      names: {},
      capabilities: Object.fromEntries(
        [...this.#capabilities.entries()].map(([capability, actors]) => [
          capability,
          [...actors].sort().map((id) => ({ id })),
        ]),
      ),
      channels: {},
    };
  }
}
