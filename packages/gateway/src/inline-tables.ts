import type { ActorId, GatewayTableAccess, GatewayTableSnapshot } from './types.js';

interface TableState {
  owner: string;
  access: GatewayTableAccess;
  rows: Map<string, unknown>;
}

export class InlineTableStore {
  #tables = new Map<string, TableState>();

  create(name: string, owner: ActorId, access: GatewayTableAccess = 'protected'): boolean {
    if (this.#tables.has(name)) return false;
    this.#tables.set(name, { owner: owner.id, access, rows: new Map() });
    return true;
  }

  names(): string[] {
    return [...this.#tables.keys()].sort();
  }

  snapshot(name: string): GatewayTableSnapshot | undefined {
    const table = this.#tables.get(name);
    if (!table) return undefined;
    return {
      name,
      owner: { id: table.owner },
      access: table.access,
      rows: table.rows.size,
    };
  }
}
