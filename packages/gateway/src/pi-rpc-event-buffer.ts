import { boundedJsonProjection } from './pi-rpc-projection.js';
import type { PiRpcEventRetentionStats, PiRpcObservedEvent } from './pi-rpc-types.js';

export const MAX_PI_RESULT_EVENTS = 512;
export const MAX_PI_RESULT_EVENT_BYTES = 2 * 1024 * 1024;
export const MAX_PI_RESULT_SINGLE_EVENT_BYTES = 64 * 1024;

export class PiRpcEventBuffer {
  readonly #events: PiRpcObservedEvent[] = [];
  readonly #eventSizes: number[] = [];
  #retainedBytes = 0;
  #originalBytes = 0;
  #originalCount = 0;
  #projectedCount = 0;

  retain(observed: PiRpcObservedEvent): void {
    const originalBytes = Buffer.byteLength(JSON.stringify(observed));
    this.#originalBytes += originalBytes;
    this.#originalCount += 1;
    const retained =
      originalBytes <= MAX_PI_RESULT_SINGLE_EVENT_BYTES ? observed : this.#project(observed);
    const retainedBytes = Buffer.byteLength(JSON.stringify(retained));
    if (retainedBytes > MAX_PI_RESULT_EVENT_BYTES) return;
    this.#events.push(retained);
    this.#eventSizes.push(retainedBytes);
    this.#retainedBytes += retainedBytes;
    while (
      this.#events.length > MAX_PI_RESULT_EVENTS ||
      this.#retainedBytes > MAX_PI_RESULT_EVENT_BYTES
    ) {
      this.#events.shift();
      this.#retainedBytes -= this.#eventSizes.shift() ?? 0;
    }
  }

  values(): PiRpcObservedEvent[] {
    return this.#events;
  }

  stats(): PiRpcEventRetentionStats {
    return {
      truncated: this.#originalCount !== this.#events.length || this.#projectedCount > 0,
      originalBytes: this.#originalBytes,
      retainedBytes: this.#retainedBytes,
      originalCount: this.#originalCount,
      retainedCount: this.#events.length,
      projectedCount: this.#projectedCount,
    };
  }

  #project(observed: PiRpcObservedEvent): PiRpcObservedEvent {
    this.#projectedCount += 1;
    return {
      ...observed,
      payload: boundedJsonProjection(observed.payload, MAX_PI_RESULT_SINGLE_EVENT_BYTES - 1_024)
        .value as Record<string, unknown>,
    };
  }
}
