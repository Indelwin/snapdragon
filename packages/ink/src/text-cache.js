import { Buffer } from 'node:buffer';

/** Bounded LRU; count bounds object overhead, bytes bound retained text. */
// Force V8 sliced strings into independent storage without normalizing lone surrogates.
const detachString = (value) => Buffer.from(value, 'utf16le').toString('utf16le');

export class TextCache {
  #entries = new Map();
  #bytes = 0;

  constructor(maxEntries = 4096, maxBytes = 8 * 1024 * 1024) {
    if (
      !Number.isSafeInteger(maxEntries) ||
      maxEntries < 1 ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1
    ) {
      throw new RangeError('Cache budgets must be positive safe integers');
    }
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    this.#entries.delete(key);
    this.#entries.set(entry.key, entry);
    return entry.value;
  }

  set(key, value) {
    if (typeof key !== 'string') throw new TypeError('Cache keys must be strings');
    const bytes = 2 * (key.length + (typeof value === 'string' ? value.length : 0)) + 128;
    this.delete(key);
    if (bytes > this.maxBytes) return;
    const retainedKey = detachString(key);
    const retainedValue = typeof value === 'string' ? detachString(value) : value;
    this.#entries.set(retainedKey, { key: retainedKey, value: retainedValue, bytes });
    this.#bytes += bytes;
    while (this.#entries.size > this.maxEntries || this.#bytes > this.maxBytes) {
      this.delete(this.#entries.keys().next().value);
    }
  }

  delete(key) {
    const entry = this.#entries.get(key);
    if (!entry) return;
    this.#bytes -= entry.bytes;
    this.#entries.delete(key);
  }

  get size() {
    return this.#entries.size;
  }
  get bytes() {
    return this.#bytes;
  }
}
