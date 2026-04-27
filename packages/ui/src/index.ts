export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface UiComponentDescriptor {
  id: string;
  kind: string;
  slot: string;
  title?: string;
  order?: number;
  visible?: boolean;
  props?: JsonObject;
}

export interface UiComponentSnapshot {
  descriptor: UiComponentDescriptor;
  state: JsonObject;
}

export interface UiLogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  source?: string;
  data?: JsonObject;
}

export type UiEvent =
  | { type: 'ui.component.register'; descriptor: UiComponentDescriptor; state?: JsonObject }
  | { type: 'ui.component.remove'; id: string }
  | { type: 'ui.component.patch'; id: string; patch: JsonObject; replace?: boolean }
  | { type: 'ui.component.clear'; id: string }
  | { type: 'ui.focus.set'; id?: string }
  | { type: 'ui.log.append'; entry: UiLogEntry }
  | { type: 'ui.reset' };

export interface UiWorldSnapshot {
  revision: number;
  components: Record<string, UiComponentSnapshot>;
  focusId?: string;
  log: UiLogEntry[];
}

export interface UiSystem {
  readonly name: string;
  readonly eventTypes: readonly UiEvent['type'][];
  apply(world: UiWorld, event: UiEvent): void;
}

export type UiWorldListener = (snapshot: UiWorldSnapshot) => void;

export class UiWorld {
  #components = new Map<string, UiComponentDescriptor>();
  #states = new Map<string, JsonObject>();
  #focusId: string | undefined;
  #log: UiLogEntry[] = [];
  #revision = 0;
  #listeners = new Set<UiWorldListener>();
  #registry: UiSystemRegistry;

  constructor(registry: UiSystemRegistry = UiSystemRegistry.defaults()) {
    this.#registry = registry;
  }

  get revision(): number {
    return this.#revision;
  }

  get focusId(): string | undefined {
    return this.#focusId;
  }

  get log(): readonly UiLogEntry[] {
    return this.#log;
  }

  apply(event: UiEvent): void {
    this.#registry.apply(this, event);
    this.#touch();
  }

  applyMany(events: readonly UiEvent[]): void {
    for (const event of events) this.#registry.apply(this, event);
    if (events.length > 0) this.#touch();
  }

  subscribe(listener: UiWorldListener): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  snapshot(): UiWorldSnapshot {
    return {
      revision: this.#revision,
      components: Object.fromEntries(
        [...this.#components.values()].map((descriptor) => [
          descriptor.id,
          {
            descriptor: cloneData(descriptor),
            state: cloneData(this.#states.get(descriptor.id) ?? {}),
          },
        ]),
      ),
      focusId: this.#focusId,
      log: this.#log.map((entry) => cloneData(entry)),
    };
  }

  component(id: string): UiComponentSnapshot | undefined {
    const descriptor = this.#components.get(id);
    if (!descriptor) return undefined;
    return {
      descriptor: cloneData(descriptor),
      state: cloneData(this.#states.get(id) ?? {}),
    };
  }

  componentState<T extends JsonObject = JsonObject>(id: string): T {
    return cloneData((this.#states.get(id) ?? {}) as T);
  }

  componentsInSlot(slot: string): UiComponentSnapshot[] {
    return [...this.#components.values()]
      .filter((descriptor) => descriptor.slot === slot && descriptor.visible !== false)
      .sort(compareDescriptors)
      .map((descriptor) => ({
        descriptor: cloneData(descriptor),
        state: cloneData(this.#states.get(descriptor.id) ?? {}),
      }));
  }

  register(descriptor: UiComponentDescriptor, state: JsonObject = {}): void {
    validateDescriptor(descriptor);
    this.#components.set(descriptor.id, cloneData(descriptor));
    this.#states.set(descriptor.id, cloneData(state));
  }

  remove(id: string): void {
    this.#components.delete(id);
    this.#states.delete(id);
    if (this.#focusId === id) this.#focusId = undefined;
  }

  patch(id: string, patch: JsonObject, replace = false): void {
    if (!this.#components.has(id)) {
      throw new Error(`Cannot patch missing UI component: ${id}`);
    }
    const next = replace ? cloneData(patch) : mergeJson(this.#states.get(id) ?? {}, patch);
    this.#states.set(id, next);
  }

  clearState(id: string): void {
    if (!this.#components.has(id)) {
      throw new Error(`Cannot clear missing UI component: ${id}`);
    }
    this.#states.set(id, {});
  }

  setFocus(id?: string): void {
    if (id && !this.#components.has(id)) {
      throw new Error(`Cannot focus missing UI component: ${id}`);
    }
    this.#focusId = id;
  }

  appendLog(entry: UiLogEntry): void {
    this.#log.push(cloneData(entry));
  }

  reset(): void {
    this.#components.clear();
    this.#states.clear();
    this.#focusId = undefined;
    this.#log = [];
  }

  #touch(): void {
    this.#revision += 1;
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
  }
}

export class UiSystemRegistry {
  #systemsByType = new Map<UiEvent['type'], UiSystem[]>();

  static defaults(): UiSystemRegistry {
    const registry = new UiSystemRegistry();
    registry.register(defaultUiSystem);
    return registry;
  }

  register(system: UiSystem): void {
    for (const eventType of system.eventTypes) {
      const systems = this.#systemsByType.get(eventType) ?? [];
      systems.push(system);
      this.#systemsByType.set(eventType, systems);
    }
  }

  apply(world: UiWorld, event: UiEvent): void {
    const systems = this.#systemsByType.get(event.type) ?? [];
    if (systems.length === 0) {
      throw new Error(`No UI system registered for event type: ${event.type}`);
    }
    for (const system of systems) system.apply(world, event);
  }
}

export function uiLog(
  level: UiLogEntry['level'],
  message: string,
  args: { id?: string; timestamp?: string; source?: string; data?: JsonObject } = {},
): UiLogEntry {
  return {
    id: args.id ?? `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    level,
    message,
    timestamp: args.timestamp ?? new Date().toISOString(),
    source: args.source,
    data: args.data,
  };
}

const defaultUiSystem: UiSystem = {
  name: 'ui.default',
  eventTypes: [
    'ui.component.register',
    'ui.component.remove',
    'ui.component.patch',
    'ui.component.clear',
    'ui.focus.set',
    'ui.log.append',
    'ui.reset',
  ],
  apply(world, event) {
    switch (event.type) {
      case 'ui.component.register':
        world.register(event.descriptor, event.state);
        return;
      case 'ui.component.remove':
        world.remove(event.id);
        return;
      case 'ui.component.patch':
        world.patch(event.id, event.patch, event.replace);
        return;
      case 'ui.component.clear':
        world.clearState(event.id);
        return;
      case 'ui.focus.set':
        world.setFocus(event.id);
        return;
      case 'ui.log.append':
        world.appendLog(event.entry);
        return;
      case 'ui.reset':
        world.reset();
    }
  },
};

function validateDescriptor(descriptor: UiComponentDescriptor): void {
  if (!descriptor.id.trim()) throw new Error('UI component id is required');
  if (!descriptor.kind.trim()) throw new Error('UI component kind is required');
  if (!descriptor.slot.trim()) throw new Error('UI component slot is required');
}

function compareDescriptors(a: UiComponentDescriptor, b: UiComponentDescriptor): number {
  const byOrder = (a.order ?? 0) - (b.order ?? 0);
  if (byOrder !== 0) return byOrder;
  return a.id.localeCompare(b.id);
}

function mergeJson(base: JsonObject, patch: JsonObject): JsonObject {
  const next = cloneData(base);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
    } else if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = mergeJson(next[key], value);
    } else {
      next[key] = cloneData(value);
    }
  }
  return next;
}

function isPlainObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
