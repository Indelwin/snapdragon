import { readFile } from 'node:fs/promises';

/**
 * Render a PNG/JPEG buffer to a string the Ink `<Text>` renderer can
 * print. Two output styles are available:
 *
 * - `'ascii'` (default) — character-based ASCII art. Each terminal cell
 *   is one ASCII glyph chosen from a brightness ramp, optionally tinted
 *   with the source pixel's RGB value. Cells are square-ish so the
 *   image reads as a real piece of TUI art rather than a tiny photo.
 *
 * - `'blocks'` — half-block pixel rendering via `terminal-image`. Each
 *   terminal cell carries two stacked pixels coloured via FG/BG ANSI
 *   codes. Higher fidelity but visually closer to a low-res screenshot;
 *   useful when you want photo-like output.
 *
 * Both paths produce a plain string with embedded ANSI escapes that
 * Ink's `<Text>` renders correctly. We deliberately do **not** emit
 * the iTerm/Kitty graphics-protocol payload — those escapes do not
 * compose with Ink's Yoga layout.
 */
export type ImageRenderStyle = 'ascii' | 'blocks';

export interface RenderImageOptions {
  /** Target width in terminal columns. */
  width?: number;
  /** Target height in terminal rows. */
  height?: number;
  /** Preserve source aspect ratio when scaling. Defaults to `true`. */
  preserveAspectRatio?: boolean;
  /** Output style. Defaults to `'ascii'` for a TUI-friendly look. */
  style?: ImageRenderStyle;
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
  if ((options.style ?? 'ascii') === 'ascii') return renderAsciiArt(buffer, options);
  return renderHalfBlocks(buffer, options);
}

// Brightness ramp ordered light → dark. We always overlay this on a
// coloured background so the ramp character provides texture rather
// than carrying the whole image — that way pastel/low-contrast input
// still reads clearly because the cell is filled.
const ASCII_RAMP = ' .:-=+*#%@';

async function renderAsciiArt(buffer: Buffer, options: RenderImageOptions): Promise<string> {
  const { Jimp } = await import('jimp');
  const image = await Jimp.read(buffer);
  const { width, height } = asciiTargetSize(image.bitmap.width, image.bitmap.height, options);
  // ASCII cells are roughly twice as tall as wide, so we squish the
  // pixel grid vertically before sampling. This yields square-looking
  // output in the terminal.
  image.resize({ w: width, h: Math.max(1, Math.round(height)) });
  return sampleAsciiPixels(image);
}

interface BitmapHolder {
  bitmap: { width: number; height: number; data: Buffer };
}

function sampleAsciiPixels(image: BitmapHolder): string {
  const { width, height, data } = image.bitmap;
  // Pre-walk to find the actual luminance range, so the ramp uses its
  // full character set even for pastel/low-contrast sources.
  const range = luminanceRange(data, width * height);
  const lines: string[] = [];
  for (let y = 0; y < height; y += 1) {
    let line = '';
    for (let x = 0; x < width; x += 1) {
      line += pixelToAsciiCell(data, (y * width + x) * 4, range);
    }
    // Reset attributes at the end of each row so a torn render can't
    // leak a trailing colour into the rest of the splash.
    lines.push(`${line}\u001b[0m`);
  }
  return lines.join('\n');
}

interface LuminanceRange {
  min: number;
  max: number;
}

function luminanceRange(data: Buffer, pixelCount: number): LuminanceRange {
  let min = 255;
  let max = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const a = data[offset + 3] ?? 255;
    if (a < 24) continue;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < min) min = luma;
    if (luma > max) max = luma;
  }
  // Guard against zero-range (solid-colour images) — fall back to the
  // full 0..255 span so the divisor below stays sane.
  if (max - min < 1) return { min: 0, max: 255 };
  return { min, max };
}

function pixelToAsciiCell(data: Buffer, offset: number, range: LuminanceRange): string {
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const a = data[offset + 3] ?? 255;
  if (a < 24) return ' ';
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  const stretched = (luma - range.min) / (range.max - range.min);
  const ramp = ASCII_RAMP;
  // Higher luminance → lighter character (earlier in ramp).
  const index = clamp(Math.floor((1 - stretched) * ramp.length), 0, ramp.length - 1);
  const char = ramp[index] ?? ' ';
  // Foreground glyph is a darkened version of the pixel so the ramp
  // texture reads against the background fill without losing the hue.
  const fg = darkenChannel(r, g, b, 0.55);
  return `\u001b[48;2;${r};${g};${b}m\u001b[38;2;${fg.r};${fg.g};${fg.b}m${char}`;
}

function darkenChannel(
  r: number,
  g: number,
  b: number,
  factor: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.round(r * factor)),
    g: Math.max(0, Math.round(g * factor)),
    b: Math.max(0, Math.round(b * factor)),
  };
}

function clamp(value: number, lower: number, upper: number): number {
  if (value < lower) return lower;
  if (value > upper) return upper;
  return value;
}

function asciiTargetSize(
  imageWidth: number,
  imageHeight: number,
  options: RenderImageOptions,
): { width: number; height: number } {
  const targetWidth = Math.max(8, Math.floor(options.width ?? 64));
  const aspect = imageHeight / imageWidth;
  // Terminal cells are about 2× taller than they are wide, so halve
  // the height when preserving the image's aspect ratio.
  const naturalHeight = Math.max(4, Math.round(targetWidth * aspect * 0.5));
  if (options.preserveAspectRatio === false) {
    return {
      width: targetWidth,
      height: Math.max(4, Math.floor(options.height ?? naturalHeight)),
    };
  }
  if (options.height) {
    const targetHeight = Math.max(4, Math.floor(options.height));
    if (targetHeight < naturalHeight) {
      const scaledWidth = Math.max(8, Math.round((targetHeight / aspect) * 2));
      return { width: scaledWidth, height: targetHeight };
    }
  }
  return { width: targetWidth, height: naturalHeight };
}

async function renderHalfBlocks(buffer: Buffer, options: RenderImageOptions): Promise<string> {
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
