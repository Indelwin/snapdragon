import { InlineMailboxStore } from './inline-mailboxes.js';
import { InlineCapabilityRegistry } from './inline-registry.js';
import { InlineServiceStore } from './inline-services.js';
import { InlineTableStore } from './inline-tables.js';
import type {
  ActorId,
  GatewayClient,
  GatewayEnvelope,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayServiceRunner,
  GatewayServiceSpec,
  GatewayServiceStatus,
  GatewayStatus,
  GatewayTableAccess,
  GatewayTableSnapshot,
} from './types.js';

export class InlineGatewayClient implements GatewayClient {
  readonly runtime = 'inline-ts' as const;
  #mailboxes = new InlineMailboxStore();
  #services = new InlineServiceStore();
  #capabilities = new InlineCapabilityRegistry();
  #tables = new InlineTableStore();

  async send(envelope: GatewayEnvelope): Promise<void> {
    this.#mailboxes.send(envelope);
  }

  async receive(
    actor: ActorId,
    filter: GatewayReceiveFilter = {},
  ): Promise<GatewayEnvelope | undefined> {
    return this.#mailboxes.receive(actor, filter);
  }

  async registerService(spec: GatewayServiceSpec, runner?: GatewayServiceRunner): Promise<void> {
    this.#services.register(spec, runner);
  }

  async enableService(name: string, enabled: boolean): Promise<void> {
    this.#services.enable(name, enabled);
  }

  async runService(name: string, signal?: AbortSignal): Promise<GatewayServiceStatus | undefined> {
    return this.#services.run(name, signal);
  }

  async listServices(): Promise<GatewayServiceStatus[]> {
    return this.#services.list();
  }

  async status(): Promise<GatewayStatus> {
    return {
      runtime: this.runtime,
      services: await this.listServices(),
      processes: this.#mailboxes.size(),
      tables: await this.tableNames(),
    };
  }

  async registerCapability(capability: string, actor: ActorId): Promise<void> {
    this.#capabilities.register(capability, actor);
  }

  async whereisCapability(capability: string): Promise<ActorId[]> {
    return this.#capabilities.whereis(capability);
  }

  async registrySnapshot(): Promise<GatewayRegistrySnapshot> {
    return this.#capabilities.snapshot();
  }

  async createTable(
    name: string,
    owner: ActorId,
    access: GatewayTableAccess = 'protected',
  ): Promise<boolean> {
    return this.#tables.create(name, owner, access);
  }

  async tableNames(): Promise<string[]> {
    return this.#tables.names();
  }

  async tableSnapshot(name: string): Promise<GatewayTableSnapshot | undefined> {
    return this.#tables.snapshot(name);
  }
}
