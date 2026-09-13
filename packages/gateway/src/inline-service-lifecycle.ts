export class InlineServiceLifecycles {
  #tails = new Map<string, Promise<void>>();

  async run<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
    const previous = this.#tails.get(name) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.catch(() => undefined).then(() => slot);
    this.#tails.set(name, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(name) === queued) this.#tails.delete(name);
    }
  }
}
