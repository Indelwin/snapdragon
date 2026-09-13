import { matchesMailboxFilter } from './inline-mailbox-filter.js';
import type { ActorId, GatewayEnvelope, GatewayReceiveFilter } from './types.js';

interface MailboxState {
  queue: GatewayEnvelope[];
  bytes: number;
}

export interface InlineMailboxLimits {
  maxMessages: number;
  maxBytes: number;
  maxMessageBytes: number;
}

const DEFAULT_LIMITS: InlineMailboxLimits = {
  maxMessages: 1_024,
  maxBytes: 8 * 1024 * 1024,
  maxMessageBytes: 1024 * 1024,
};

export class InlineMailboxStore {
  #mailboxes = new Map<string, MailboxState>();

  constructor(private readonly limits: InlineMailboxLimits = DEFAULT_LIMITS) {}

  send(envelope: GatewayEnvelope): void {
    const mailbox = this.#mailbox(envelope.target);
    const bytes = serializedBytes(envelope);
    if (bytes > this.limits.maxMessageBytes) {
      throw new Error(
        `mailbox message oversized: ${bytes} bytes exceeds ${this.limits.maxMessageBytes}`,
      );
    }
    if (
      mailbox.queue.length >= this.limits.maxMessages ||
      mailbox.bytes + bytes > this.limits.maxBytes
    ) {
      throw new Error(
        `mailbox busy: ${mailbox.queue.length}/${this.limits.maxMessages} messages and ${mailbox.bytes}/${this.limits.maxBytes} bytes`,
      );
    }
    mailbox.queue.push(envelope);
    mailbox.bytes += bytes;
  }

  receive(actor: ActorId, filter: GatewayReceiveFilter = {}): GatewayEnvelope | undefined {
    const mailbox = this.#mailbox(actor);
    const index = mailbox.queue.findIndex((envelope) => matchesMailboxFilter(envelope, filter));
    if (index < 0) return undefined;
    const [envelope] = mailbox.queue.splice(index, 1);
    mailbox.bytes -= serializedBytes(envelope);
    return envelope;
  }

  size(): number {
    return this.#mailboxes.size;
  }

  #mailbox(actor: ActorId): MailboxState {
    const existing = this.#mailboxes.get(actor.id);
    if (existing) return existing;
    const mailbox = { queue: [], bytes: 0 };
    this.#mailboxes.set(actor.id, mailbox);
    return mailbox;
  }
}

function serializedBytes(envelope: GatewayEnvelope): number {
  try {
    return Buffer.byteLength(JSON.stringify(envelope));
  } catch (error) {
    throw new Error(`mailbox message is not JSON serializable: ${String(error)}`);
  }
}
