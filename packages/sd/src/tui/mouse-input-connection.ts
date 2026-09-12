import { MouseInputMode } from './mouse-input-mode.js';
import type { MouseInputSource, MouseOutput } from './mouse-input-types.js';

export type { MouseInputSource, MouseOutput } from './mouse-input-types.js';

interface MouseInputHandlers {
  data: (chunk: Buffer) => void;
  end: () => void;
  error: (error: Error) => void;
}

export function supportsMouseInput(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): boolean {
  const source = input as MouseInputSource;
  const terminalOutput = output as MouseOutput;
  return [source.isTTY, terminalOutput.isTTY, typeof source.setRawMode === 'function'].every(
    Boolean,
  );
}

export class MouseInputConnection {
  private readonly source: MouseInputSource;
  private connected = false;
  private readonly mode: MouseInputMode;
  private sourceWasFlowing: boolean | null | undefined;
  private pausedForBackpressure = false;

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream,
    private readonly handlers: MouseInputHandlers,
  ) {
    this.source = input as MouseInputSource;
    this.mode = new MouseInputMode(this.source, this.onError);
  }

  connect(): void {
    if (this.connected) return;
    this.sourceWasFlowing = this.source.readableFlowing;
    this.connected = true;
    this.source.on('data', this.onData);
    this.source.on('end', this.onEnd);
    this.source.on('close', this.onEnd);
    this.source.on('error', this.onError);
    this.output.on('error', this.onError);
    this.source.resume();
  }

  stop(): void {
    this.disconnect();
    this.restoreInputFlow();
    this.mode.restore();
  }

  pauseForBackpressure(): void {
    if (!this.connected || this.pausedForBackpressure) return;
    this.pausedForBackpressure = true;
    this.source.pause();
  }

  resumeForDemand(): void {
    if (!this.connected || !this.pausedForBackpressure) return;
    this.pausedForBackpressure = false;
    this.source.resume();
  }

  setRawMode(enabled: boolean): void {
    this.mode.setRawMode(enabled);
  }

  ref(): void {
    this.mode.ref();
  }

  unref(): void {
    this.mode.unref();
  }

  private readonly onData = (chunk: Buffer | string): void => {
    this.handlers.data(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  };

  private readonly onEnd = (): void => this.handlers.end();

  private readonly onError = (error: unknown): void => {
    this.handlers.error(error instanceof Error ? error : new Error(String(error)));
  };

  private disconnect(): void {
    if (!this.connected) return;
    this.connected = false;
    this.source.removeListener('data', this.onData);
    this.source.removeListener('end', this.onEnd);
    this.source.removeListener('close', this.onEnd);
    this.source.removeListener('error', this.onError);
    this.output.removeListener('error', this.onError);
  }

  private restoreInputFlow(): void {
    const sourceWasFlowing = this.sourceWasFlowing;
    if (sourceWasFlowing === undefined) return;
    this.sourceWasFlowing = undefined;
    this.pausedForBackpressure = false;
    try {
      if (sourceWasFlowing) this.source.resume();
      else {
        this.source.pause();
        if (sourceWasFlowing === null) this.source.readableFlowing = null;
      }
    } catch {
      // A failed input stream may reject flow restoration during teardown.
    }
  }
}
