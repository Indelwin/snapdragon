import type { MouseInputSource } from './mouse-input-types.js';

export class MouseInputMode {
  private rawModeEnabled = false;
  private sourceReferenced = false;

  constructor(
    private readonly source: MouseInputSource,
    private readonly onError: (error: unknown) => void,
  ) {}

  setRawMode(enabled: boolean): void {
    if (this.rawModeEnabled === enabled) return;
    this.rawModeEnabled = enabled;
    this.perform(() => this.source.setRawMode?.(enabled));
  }

  ref(): void {
    if (this.sourceReferenced) return;
    this.sourceReferenced = true;
    this.perform(() => this.source.ref?.());
  }

  unref(): void {
    if (!this.sourceReferenced) return;
    this.sourceReferenced = false;
    this.perform(() => this.source.unref?.());
  }

  restore(): void {
    if (this.rawModeEnabled) {
      this.rawModeEnabled = false;
      try {
        this.source.setRawMode?.(false);
      } catch {
        // A failed input may reject terminal-mode restoration.
      }
    }
    if (this.sourceReferenced) {
      this.sourceReferenced = false;
      try {
        this.source.unref?.();
      } catch {
        // Ref state is best-effort once the injected stream has failed.
      }
    }
  }

  private perform(action: () => unknown): void {
    try {
      action();
    } catch (error) {
      this.onError(error);
      throw error;
    }
  }
}
