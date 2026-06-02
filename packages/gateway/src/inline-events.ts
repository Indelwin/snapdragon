import type { GatewayEventRecord } from './types.js';

type InlineLog = (
  level: string,
  target: string | undefined,
  message: string,
  data?: unknown,
) => void;

export class InlineEventStore {
  #events = new Map<string, GatewayEventRecord>();

  constructor(private readonly log: InlineLog) {}

  append(input: {
    id?: string;
    kind: string;
    target?: string;
    payload?: unknown;
  }): GatewayEventRecord {
    const now = Date.now();
    const event: GatewayEventRecord = {
      id: input.id ?? inlineId('event'),
      kind: input.kind,
      target: input.target,
      state: 'pending',
      payload: input.payload ?? {},
      createdAtMs: now,
      updatedAtMs: now,
    };
    this.#events.set(event.id, event);
    this.log('info', event.id, 'event appended', { kind: event.kind });
    return event;
  }

  list(): GatewayEventRecord[] {
    return [...this.#events.values()].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }

  cancel(id: string): GatewayEventRecord | undefined {
    const event = this.#events.get(id);
    if (!event) return undefined;
    event.state = 'cancelled';
    event.updatedAtMs = Date.now();
    this.log('warn', id, 'event cancelled');
    return event;
  }
}

function inlineId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
