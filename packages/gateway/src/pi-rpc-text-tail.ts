import { compactBuffers, utf8Suffix } from './pi-rpc-utf8.js';

export class PiRpcTextTail {
  #fragments: Buffer[] = [];
  #bytes = 0;

  constructor(private readonly limit: number) {}

  append(value: Buffer): void {
    const suffix = utf8Suffix(value, this.limit);
    if (suffix.length > 0) {
      this.#fragments.push(suffix);
      this.#bytes += suffix.length;
    }
    while (this.#bytes > this.limit && this.#fragments.length > 0) {
      const excess = this.#bytes - this.limit;
      const first = this.#fragments[0];
      if (!first) break;
      if (first.length <= excess) {
        this.#fragments.shift();
        this.#bytes -= first.length;
        continue;
      }
      const retained = utf8Suffix(first, first.length - excess);
      this.#fragments[0] = retained;
      this.#bytes += retained.length - first.length;
    }
    this.#fragments = compactBuffers(this.#fragments, this.#bytes);
  }

  clear(): void {
    this.#fragments = [];
    this.#bytes = 0;
  }

  value(): string {
    return Buffer.concat(this.#fragments, this.#bytes).toString('utf8');
  }

  size(): number {
    return this.#bytes;
  }
}
