import { PiRpcTextTail } from './pi-rpc-text-tail.js';
import type { PiRpcRetentionStats } from './pi-rpc-types.js';
import { compactBuffers, utf8Prefix } from './pi-rpc-utf8.js';

const MARKER_RESERVE_BYTES = 160;

export class BoundedTextPreview {
  readonly #headLimit: number;
  readonly #tailLimit: number;
  #complete: Buffer[] = [];
  #completeBytes = 0;
  #head: Buffer[] = [];
  #headBytes = 0;
  readonly #tail: PiRpcTextTail;
  #originalBytes = 0;
  #truncated = false;

  constructor(readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes <= MARKER_RESERVE_BYTES) {
      throw new Error(`Pi RPC preview limit must exceed ${MARKER_RESERVE_BYTES} bytes`);
    }
    const payloadBytes = maxBytes - MARKER_RESERVE_BYTES;
    this.#headLimit = Math.ceil(payloadBytes / 2);
    this.#tailLimit = Math.floor(payloadBytes / 2);
    this.#tail = new PiRpcTextTail(this.#tailLimit);
  }

  append(value: string): void {
    if (!value) return;
    const bytes = Buffer.from(value, 'utf8');
    this.#originalBytes += bytes.length;
    if (!this.#truncated && this.#completeBytes + bytes.length <= this.maxBytes) {
      this.#complete.push(bytes);
      this.#completeBytes += bytes.length;
      this.#complete = compactBuffers(this.#complete, this.#completeBytes);
      return;
    }
    if (!this.#truncated) this.#startTruncating();
    this.#appendTruncated(bytes);
  }

  replace(value: string): void {
    this.#complete = [];
    this.#completeBytes = 0;
    this.#head = [];
    this.#headBytes = 0;
    this.#tail.clear();
    this.#originalBytes = 0;
    this.#truncated = false;
    this.append(value);
  }

  value(): string {
    if (!this.#truncated)
      return Buffer.concat(this.#complete, this.#completeBytes).toString('utf8');
    const omittedBytes = this.#originalBytes - this.#headBytes - this.#tail.size();
    const marker = `\n[Pi RPC preview truncated: ${omittedBytes} byte(s) omitted]\n`;
    return `${Buffer.concat(this.#head, this.#headBytes).toString('utf8')}${marker}${this.#tail.value()}`;
  }

  stats(): PiRpcRetentionStats {
    return {
      truncated: this.#truncated,
      originalBytes: this.#originalBytes,
      retainedBytes: this.#truncated ? this.#headBytes + this.#tail.size() : this.#completeBytes,
    };
  }

  #startTruncating(): void {
    this.#truncated = true;
    for (const fragment of this.#complete) this.#appendTruncated(fragment);
    this.#complete = [];
    this.#completeBytes = 0;
  }

  #appendTruncated(bytes: Buffer): void {
    if (this.#headBytes < this.#headLimit) {
      const prefix = utf8Prefix(bytes, this.#headLimit - this.#headBytes);
      if (prefix.length > 0) {
        this.#head.push(prefix);
        this.#headBytes += prefix.length;
        this.#head = compactBuffers(this.#head, this.#headBytes);
      }
    }
    this.#tail.append(bytes);
  }
}
