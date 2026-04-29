import { readFile } from 'node:fs/promises';

/**
 * Render a PNG/JPEG buffer to a string the Ink `<Text>` renderer can
 * print. On terminals that support a graphics protocol (iTerm2, Kitty,
 * WezTerm) `terminal-image` will use that protocol so the image renders
 * at full resolution; on everything else it falls back to ANSI block
 * characters.
 *
 * The function is intentionally narrow: it loads `terminal-image`
 * lazily so the dep doesn't pay its `jimp` bootstrap cost on every
 * `sd` invocation, only when an image is actually rendered.
 */
export interface RenderImageOptions {
  /** Target width in terminal columns. */
  width?: number;
  /** Target height in terminal rows (each row ≈ 2 vertical pixels). */
  height?: number;
  /** Preserve PNG alpha channel; defaults to true. */
  preserveAspectRatio?: boolean;
}

// Env vars that `terminal-image` / `term-img` / `supports-terminal-graphics`
// inspect to decide whether to emit a graphics-protocol payload (iTerm2,
// Kitty, WezTerm) instead of plain ANSI block characters. Those protocol
// payloads do not play well inside Ink's layout — Yoga can't measure
// them, so subsequent content overlaps the image. For the in-tree
// splash banner we always want the ANSI block fallback. Scrubbing
// these variables for the duration of the render reliably forces it.
const GRAPHICS_DETECTION_ENV_VARS = [
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'KITTY_WINDOW_ID',
  'KITTY_PID',
  'WEZTERM_PANE',
  'WEZTERM_EXECUTABLE',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'GHOSTTY_RESOURCES_DIR',
] as const;

export async function renderImageAscii(
  buffer: Buffer,
  options: RenderImageOptions = {},
): Promise<string> {
  const restore = scrubGraphicsDetectionEnv();
  try {
    const { default: terminalImage } = await import('terminal-image');
    return await terminalImage.buffer(buffer, {
      width: options.width,
      height: options.height,
      preserveAspectRatio: options.preserveAspectRatio ?? true,
    });
  } finally {
    restore();
  }
}

function scrubGraphicsDetectionEnv(): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of GRAPHICS_DETECTION_ENV_VARS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export async function renderImageFile(
  path: string,
  options: RenderImageOptions = {},
): Promise<string> {
  const buffer = await readFile(path);
  return renderImageAscii(buffer, options);
}
