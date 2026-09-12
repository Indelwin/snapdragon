const MOUSE_MODE_ENABLE = '\x1b[?1000h\x1b[?1006h';
const MOUSE_MODE_DISABLE = '\x1b[?1006l\x1b[?1000l';

export class MouseTerminalMode {
  private activationCount = 0;
  private enabled = false;

  constructor(
    private readonly output: NodeJS.WritableStream,
    private readonly onError: (error: Error) => void,
  ) {}

  activate(): () => void {
    this.activationCount += 1;
    if (this.activationCount === 1) this.enable();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.activationCount -= 1;
      if (this.activationCount === 0) this.disable();
    };
  }

  stop(): void {
    this.activationCount = 0;
    this.disable();
  }

  private enable(): void {
    this.enabled = true;
    try {
      this.output.write(MOUSE_MODE_ENABLE);
    } catch (error) {
      this.stop();
      this.onError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  private disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    try {
      this.output.write(MOUSE_MODE_DISABLE);
    } catch {
      // The output is already unusable; local mode state is still cleared.
    }
  }
}
