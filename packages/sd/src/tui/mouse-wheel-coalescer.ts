export const MOUSE_WHEEL_COALESCE_MS = 33;

type WheelListener = (ticks: number) => void;

export class MouseWheelCoalescer {
  private readonly listeners = new Set<WheelListener>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticks = 0;

  constructor(
    private readonly onError: (error: Error) => void,
    private readonly delayMs = MOUSE_WHEEL_COALESCE_MS,
  ) {}

  subscribe(listener: WheelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  push(ticks: number): void {
    if (ticks === 0) return;
    this.ticks += ticks;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.ticks = 0;
  }

  dispose(): void {
    this.stop();
    this.listeners.clear();
  }

  private flush(): void {
    this.timer = undefined;
    const ticks = this.ticks;
    this.ticks = 0;
    if (ticks === 0) return;
    for (const listener of this.listeners) {
      try {
        listener(ticks);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }
}

export function wheelTicksForButton(button: number): number {
  if ((button & 0x40) === 0 || (button & 0x20) !== 0) return 0;
  const direction = button & 0x03;
  if (direction === 0) return 1;
  if (direction === 1) return -1;
  return 0;
}
