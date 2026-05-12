import type { AgentEvent } from '@snapdragon-ai/agent';
import type { StreamEvent } from '@snapdragon-ai/host';

type BufferedProviderEvent = Extract<
  StreamEvent,
  { kind: 'text' | 'thinking' | 'input_json_delta' }
>;

const STREAM_PATCH_INTERVAL_MS = 33;
const BUFFERED_EVENT_KINDS = new Set(['text', 'thinking', 'input_json_delta']);
export const MAX_PROVIDER_EVENT_BUFFER_CHARS = 64_000;

export class ProviderEventBuffer {
  readonly #flushEvents: (events: readonly BufferedProviderEvent[]) => void;
  #events: BufferedProviderEvent[] = [];
  #bufferedChars = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(flushEvents: (events: readonly BufferedProviderEvent[]) => void) {
    this.#flushEvents = flushEvents;
  }

  accept(event: AgentEvent): boolean {
    if (event.type !== 'provider_event') return false;
    if (!BUFFERED_EVENT_KINDS.has(event.event.kind)) return false;
    this.#enqueue(event.event as BufferedProviderEvent);
    return true;
  }

  flush(): void {
    this.#clearTimer();
    const events = this.#events;
    this.#events = [];
    this.#bufferedChars = 0;
    if (events.length === 0) return;
    this.#flushEvents(events);
  }

  #enqueue(event: BufferedProviderEvent): void {
    const index = this.#events.length - 1;
    const last = this.#events[index];
    if (last && eventKey(last) === eventKey(event)) {
      this.#events[index] = { ...last, delta: last.delta + event.delta };
    } else {
      this.#events.push(event);
    }
    this.#bufferedChars += event.delta.length;
    if (this.#bufferedChars >= MAX_PROVIDER_EVENT_BUFFER_CHARS) {
      this.flush();
      return;
    }
    if (this.#timer === undefined) {
      this.#timer = setTimeout(() => this.flush(), STREAM_PATCH_INTERVAL_MS);
    }
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }
}

function eventKey(event: BufferedProviderEvent): string {
  return `${event.kind}:${event.run_id}:${event.provider}`;
}
