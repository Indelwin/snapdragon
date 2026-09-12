export const RELOAD_OUTPUT_TAIL_BYTES = 64 * 1024;

export class BoundedOutputTail {
  readonly #limit: number;
  #value = Buffer.alloc(0);

  constructor(limit = RELOAD_OUTPUT_TAIL_BYTES) {
    this.#limit = Math.max(1, Math.floor(limit));
  }

  append(chunk: Buffer | string): void {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (incoming.length >= this.#limit) {
      this.#value = Buffer.from(incoming.subarray(incoming.length - this.#limit));
      return;
    }
    const retained = this.#value.subarray(
      Math.max(0, this.#value.length + incoming.length - this.#limit),
    );
    this.#value = Buffer.concat([retained, incoming], retained.length + incoming.length);
  }

  text(): string {
    return this.#value.toString('utf8');
  }
}
