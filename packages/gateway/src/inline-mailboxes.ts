import type { ActorId, GatewayEnvelope, GatewayReceiveFilter } from './types.js';

interface MailboxState {
  queue: GatewayEnvelope[];
}

export class InlineMailboxStore {
  #mailboxes = new Map<string, MailboxState>();

  send(envelope: GatewayEnvelope): void {
    this.#mailbox(envelope.target).queue.push(envelope);
  }

  receive(actor: ActorId, filter: GatewayReceiveFilter = {}): GatewayEnvelope | undefined {
    const mailbox = this.#mailbox(actor);
    const index = mailbox.queue.findIndex((envelope) => matchesFilter(envelope, filter));
    if (index < 0) return undefined;
    const [envelope] = mailbox.queue.splice(index, 1);
    return envelope;
  }

  size(): number {
    return this.#mailboxes.size;
  }

  #mailbox(actor: ActorId): MailboxState {
    const existing = this.#mailboxes.get(actor.id);
    if (existing) return existing;
    const mailbox = { queue: [] };
    this.#mailboxes.set(actor.id, mailbox);
    return mailbox;
  }
}

function matchesFilter(envelope: GatewayEnvelope, filter: GatewayReceiveFilter): boolean {
  if (filter.kind !== undefined && filter.kind !== envelope.kind) return false;
  if (filter.source !== undefined && filter.source.id !== envelope.source?.id) return false;
  if (filter.correlationId !== undefined && filter.correlationId !== envelope.correlationId) {
    return false;
  }
  if (filter.capability !== undefined && filter.capability !== envelope.capability) return false;
  return true;
}
