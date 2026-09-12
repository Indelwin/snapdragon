export const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

export class GatewaySseDecoder {
  #lineParts: string[] = [];
  #lineBytes = 0;
  #frameBytes = 0;
  #data: string[] = [];

  push(chunk: string): string[] {
    const messages: string[] = [];
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf('\n', start);
      if (newline < 0) break;
      this.#appendLinePart(chunk.slice(start, newline));
      this.#frameBytes += this.#lineBytes + 1;
      this.#assertFrameSize();
      this.#acceptLine(this.#takeLine(), messages);
      start = newline + 1;
    }
    this.#appendLinePart(chunk.slice(start));
    this.#assertFrameSize(this.#lineBytes);
    return messages;
  }

  finish(chunk = ''): string[] {
    const messages = this.push(chunk);
    if (this.#lineBytes > 0 || this.#lineParts.length > 0) {
      this.#frameBytes += this.#lineBytes;
      this.#assertFrameSize();
      this.#acceptLine(this.#takeLine(), messages);
    }
    const tail = this.#takeMessage();
    if (tail) messages.push(tail);
    this.#resetFrame();
    return messages;
  }

  #appendLinePart(part: string): void {
    if (!part) return;
    this.#lineParts.push(part);
    this.#lineBytes += Buffer.byteLength(part);
  }

  #takeLine(): string {
    const line = this.#lineParts.join('');
    this.#lineParts = [];
    this.#lineBytes = 0;
    return line.endsWith('\r') ? line.slice(0, -1) : line;
  }

  #acceptLine(line: string, messages: string[]): void {
    if (line === '') {
      const message = this.#takeMessage();
      if (message) messages.push(message);
      this.#resetFrame();
      return;
    }
    if (!line.startsWith('data:')) return;
    let value = line.slice(5);
    if (value.startsWith(' ')) value = value.slice(1);
    this.#data.push(value);
  }

  #takeMessage(): string | undefined {
    return this.#data.length > 0 ? this.#data.join('\n') : undefined;
  }

  #resetFrame(): void {
    this.#frameBytes = 0;
    this.#data = [];
  }

  #assertFrameSize(pendingBytes = 0): void {
    if (this.#frameBytes + pendingBytes > MAX_SSE_BUFFER_BYTES) {
      throw new Error(`Gateway SSE event exceeds ${MAX_SSE_BUFFER_BYTES} bytes`);
    }
  }
}
