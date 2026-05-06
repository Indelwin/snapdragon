import type {
  ActorId,
  GatewayEnvelope,
  GatewayReceiveFilter,
  GatewayRegistrySnapshot,
  GatewayServiceSpec,
  GatewayTableAccess,
  GatewayTableSnapshot,
} from './types.js';

interface WireTableSnapshot {
  name: string;
  owner: unknown;
  access: string;
  rows: number;
}

export function toWireActor(actor: ActorId): string {
  return actor.id;
}

export function fromWireActor(value: unknown): ActorId {
  return { id: typeof value === 'string' ? value : String((value as ActorId).id) };
}

export function toWireEnvelope(envelope: GatewayEnvelope): Record<string, unknown> {
  return {
    id: envelope.id,
    kind: envelope.kind,
    source: envelope.source ? toWireActor(envelope.source) : null,
    target: toWireActor(envelope.target),
    correlation_id: envelope.correlationId ?? null,
    capability: envelope.capability ?? null,
    payload: envelope.payload,
    inserted_at_ms: envelope.insertedAtMs,
  };
}

export function fromWireEnvelope(value: any): GatewayEnvelope | undefined {
  if (!value) return undefined;
  return {
    id: Number(value.id),
    kind: String(value.kind),
    source: value.source ? fromWireActor(value.source) : undefined,
    target: fromWireActor(value.target),
    correlationId: value.correlation_id ?? undefined,
    capability: value.capability ?? undefined,
    payload: value.payload,
    insertedAtMs: Number(value.inserted_at_ms ?? 0),
  };
}

export function toWireFilter(filter: GatewayReceiveFilter = {}): Record<string, unknown> {
  return {
    kind: filter.kind ?? null,
    source: filter.source ? toWireActor(filter.source) : null,
    correlation_id: filter.correlationId ?? null,
    capability: filter.capability ?? null,
  };
}

export function toWireServiceSpec(spec: GatewayServiceSpec): Record<string, unknown> {
  return {
    name: spec.name,
    enabled: spec.enabled ?? true,
    interval_ms: spec.intervalMs ?? null,
    startup_delay_ms: spec.startupDelayMs ?? null,
    restart: spec.restart ?? 'transient',
    restart_intensity: spec.restartIntensity
      ? {
          max_restarts: spec.restartIntensity.maxRestarts ?? 3,
          within_ms: spec.restartIntensity.withinMs ?? 60_000,
        }
      : undefined,
    backoff_ms: spec.backoffMs ?? null,
    max_backoff_ms: spec.maxBackoffMs ?? null,
    budget: spec.budget
      ? { max_fuel: spec.budget.maxFuel ?? null, timeout_ms: spec.budget.timeoutMs ?? null }
      : null,
    worker: spec.worker
      ? {
          command: spec.worker.command,
          args: spec.worker.args ?? [],
          cwd: spec.worker.cwd ?? null,
          env: spec.worker.env ?? {},
        }
      : null,
  };
}

export function fromWireRegistrySnapshot(value: any): GatewayRegistrySnapshot {
  return {
    names: actorRecord(value?.names),
    capabilities: Object.fromEntries(
      Object.entries(value?.capabilities ?? {}).map(([capability, actors]) => [
        capability,
        Array.isArray(actors) ? actors.map(fromWireActor) : [],
      ]),
    ),
    channels: actorRecord(value?.channels),
  };
}

export function fromWireTableSnapshot(
  value: WireTableSnapshot | undefined,
): GatewayTableSnapshot | undefined {
  if (!value) return undefined;
  return {
    name: value.name,
    owner: fromWireActor(value.owner),
    access: fromWireTableAccess(value.access),
    rows: Number(value.rows ?? 0),
  };
}

export function toWireTableAccess(access: GatewayTableAccess): string {
  return {
    public: 'Public',
    protected: 'Protected',
    private: 'Private',
  }[access];
}

function fromWireTableAccess(value: string): GatewayTableAccess {
  const normalized = value.toLowerCase();
  if (normalized === 'public') return 'public';
  if (normalized === 'private') return 'private';
  return 'protected';
}

function actorRecord(value: Record<string, unknown> | undefined): Record<string, ActorId> {
  return Object.fromEntries(
    Object.entries(value ?? {}).map(([name, actor]) => [name, fromWireActor(actor)]),
  );
}
