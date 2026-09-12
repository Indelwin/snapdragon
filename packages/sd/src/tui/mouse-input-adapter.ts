import { PassThrough } from 'node:stream';
import { MouseInputConnection, supportsMouseInput } from './mouse-input-connection.js';
import { MouseSgrParser } from './mouse-sgr-parser.js';
import { MouseTerminalMode } from './mouse-terminal-mode.js';
import { MOUSE_WHEEL_COALESCE_MS, MouseWheelCoalescer } from './mouse-wheel-coalescer.js';

const DEFAULT_FRAGMENT_TIMEOUT_MS = 33;

type ErrorListener = (error: Error) => void;

export { MOUSE_WHEEL_COALESCE_MS } from './mouse-wheel-coalescer.js';

export interface MouseInputAdapterOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  fragmentTimeoutMs?: number;
  wheelCoalesceMs?: number;
}

export function createMouseInputAdapter(
  options: MouseInputAdapterOptions & { enabled: boolean },
): SdMouseInputAdapter | undefined {
  if (!options.enabled || !supportsMouseInput(options.input, options.output)) return undefined;
  return new SdMouseInputAdapter(options);
}

/** Filters mouse reports before Ink while proxying its injected stdin controls. */
export class SdMouseInputAdapter extends PassThrough {
  readonly isTTY = true;

  private readonly parser = new MouseSgrParser();
  private readonly connection: MouseInputConnection;
  private readonly terminalMode: MouseTerminalMode;
  private readonly wheel: MouseWheelCoalescer;
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly fragmentTimeoutMs: number;
  private fragmentTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private failure: Error | undefined;

  constructor(options: MouseInputAdapterOptions) {
    super();
    this.fragmentTimeoutMs = options.fragmentTimeoutMs ?? DEFAULT_FRAGMENT_TIMEOUT_MS;
    this.wheel = new MouseWheelCoalescer(
      (error) => this.fail(error),
      options.wheelCoalesceMs ?? MOUSE_WHEEL_COALESCE_MS,
    );
    this.terminalMode = new MouseTerminalMode(options.output, (error) => this.fail(error));
    this.connection = new MouseInputConnection(options.input, options.output, {
      data: (chunk) => this.accept(chunk),
      end: () => this.finishInput(),
      error: (error) => this.fail(error),
    });
    this.connection.connect();
  }

  setRawMode(enabled: boolean): this {
    this.connection.setRawMode(enabled);
    return this;
  }

  ref(): this {
    this.connection.ref();
    return this;
  }

  unref(): this {
    this.connection.unref();
    return this;
  }

  override _read(size: number): void {
    super._read(size);
    this.connection.resumeForDemand();
  }

  subscribeWheel(listener: (ticks: number) => void): () => void {
    return this.wheel.subscribe(listener);
  }

  subscribeError(listener: ErrorListener): () => void {
    if (this.failure) {
      listener(this.failure);
      return () => undefined;
    }
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  activate(): () => void {
    if (this.disposed || this.failure) throw new Error('Cannot activate a stopped mouse adapter');
    const deactivateTerminal = this.terminalMode.activate();
    return () => {
      deactivateTerminal();
      this.clearFragmentTimer();
      this.parser.reset();
      this.wheel.stop();
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.terminalMode.stop();
    this.connection.stop();
    this.clearFragmentTimer();
    this.parser.reset();
    this.wheel.dispose();
    this.errorListeners.clear();
    this.end();
  }

  private accept(chunk: Buffer): void {
    this.clearFragmentTimer();
    const result = this.parser.push(chunk);
    this.forward(result.output);
    this.wheel.push(result.wheelTicks);
    if (this.parser.shouldFlushPending) {
      this.fragmentTimer = setTimeout(() => this.flushParser(), this.fragmentTimeoutMs);
    }
  }

  private finishInput(): void {
    this.flushParser();
    this.dispose();
  }

  private flushParser(): void {
    this.clearFragmentTimer();
    this.forward(this.parser.flush());
  }

  private forward(output: Buffer): void {
    if (output.length > 0 && !this.push(output)) this.connection.pauseForBackpressure();
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    this.connection.stop();
    this.terminalMode.stop();
    this.clearFragmentTimer();
    this.parser.reset();
    this.wheel.stop();
    this.end();
    this.errorListeners.forEach((listener) => {
      listener(error);
    });
  }

  private clearFragmentTimer(): void {
    if (this.fragmentTimer) clearTimeout(this.fragmentTimer);
    this.fragmentTimer = undefined;
  }
}
