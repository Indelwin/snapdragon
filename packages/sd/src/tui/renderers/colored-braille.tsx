import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { tuiColors } from '../theme.js';

/**
 * Per-cell coloured braille image renderer.
 *
 * Each rendered cell is a Unicode Braille glyph (U+2800–U+28FF, 8
 * dots packed into a 2×4 grid). For every cell we keep the colour
 * averaged from the ON dots' source pixels, so the image takes its
 * tint from the source rather than wearing a single uniform paint.
 *
 * Backgrounds are detected by sampling the four corner pixels of the
 * resized image; pixels within `BG_THRESHOLD_DISTANCE` (Euclidean RGB)
 * are treated as transparent and the cell sits empty. With a clean,
 * solid-coloured background (lavender in the splash case) this cuts
 * the subject cleanly out of its surround.
 *
 * When `shimmer` is enabled, a slow diagonal wave of the highlight
 * colour sweeps through the image — same idea as the existing
 * `Shimmer` text effect, but applied to per-cell colour blending so
 * the dragon's own hues are preserved between waves.
 */
export interface ColoredBrailleImageProps {
  src: string;
  /** Output width in terminal cells. */
  width: number;
  /** Output height in terminal cells. */
  height: number;
  /** When true, animate a slow diagonal shimmer wave across the image. */
  shimmer?: boolean;
  /** Wave-head highlight colour for the shimmer overlay. Defaults to accent. */
  shimmerColor?: string;
  /** Tick interval for the shimmer in milliseconds. Defaults to 120ms. */
  shimmerIntervalMs?: number;
  /** Placeholder shown while the image decodes. */
  alt?: string;
}

interface Cell {
  /** Braille glyph, or `undefined` if all dots in this cell are transparent. */
  char: string | undefined;
  /** Mean R/G/B of the cell's ON dots; ignored when `char` is undefined. */
  r: number;
  g: number;
  b: number;
}

type CellGrid = Cell[][];

const BRAILLE_BASE = 0x2800;
const EMPTY_BRAILLE_GLYPH = String.fromCharCode(BRAILLE_BASE);

// Bit positions of the 8 dots within a Unicode Braille pattern.
const DOT_BITS = [
  { dx: 0, dy: 0, bit: 0 },
  { dx: 0, dy: 1, bit: 1 },
  { dx: 0, dy: 2, bit: 2 },
  { dx: 1, dy: 0, bit: 3 },
  { dx: 1, dy: 1, bit: 4 },
  { dx: 1, dy: 2, bit: 5 },
  { dx: 0, dy: 3, bit: 6 },
  { dx: 1, dy: 3, bit: 7 },
] as const;

// Pixels within this Euclidean RGB distance of the sampled background
// average are treated as transparent. 30 catches the lavender splash
// background's slight gradient without eating into the dragon's
// outline (dark purple is ~40+ away from light lavender).
const BG_THRESHOLD_DISTANCE = 30;

// Diagonal-beam width in cells. Larger fade = smoother, gentler wave.
const SHIMMER_FADE_CELLS = 8;

export function ColoredBrailleImage({
  src,
  width,
  height,
  shimmer = false,
  shimmerColor = tuiColors.accent,
  shimmerIntervalMs = 120,
  alt,
}: ColoredBrailleImageProps) {
  const [grid, setGrid] = useState<CellGrid | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rendered = await renderGrid(src, width, height);
        if (!cancelled) setGrid(rendered);
      } catch {
        if (!cancelled) setGrid([[]]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, width, height]);

  if (!grid || grid.length === 0) {
    return <Text color={tuiColors.muted}>{alt ?? 'loading…'}</Text>;
  }
  if (shimmer) {
    return <ShimmerGrid grid={grid} highlight={shimmerColor} intervalMs={shimmerIntervalMs} />;
  }
  return <StaticGrid grid={grid} />;
}

function StaticGrid({ grid }: { grid: CellGrid }) {
  return (
    <Box flexDirection="column">
      {grid.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length grid
        <Text key={rowIndex}>{rowToString(row, () => 0, undefined)}</Text>
      ))}
    </Box>
  );
}

function ShimmerGrid({
  grid,
  highlight,
  intervalMs,
}: {
  grid: CellGrid;
  highlight: string;
  intervalMs: number;
}) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => (value + 1) % 1_000_000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const rows = grid.length;
  const cols = rows > 0 ? (grid[0]?.length ?? 0) : 0;
  // Wave traverses the diagonal so it has visual movement on both
  // axes simultaneously. Period adds a buffer past the bottom-right
  // corner so there's a brief "rest" between sweeps.
  const period = rows + cols + SHIMMER_FADE_CELLS * 2;
  const head = tick % period;
  const highlightRgb = parseHexColor(highlight) ?? { r: 255, g: 127, b: 163 };

  return (
    <Box flexDirection="column">
      {grid.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length grid
        <Text key={rowIndex}>
          {rowToString(row, (colIndex) => waveAlpha(rowIndex, colIndex, head), highlightRgb)}
        </Text>
      ))}
    </Box>
  );
}

function rowToString(
  row: readonly Cell[],
  cellAlpha: (rowCellIndex: number) => number,
  highlight: RGB | undefined,
): string {
  let result = '';
  for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
    const cell = row[colIndex];
    if (!cell || !cell.char) {
      result += ' ';
      continue;
    }
    const alpha = highlight ? cellAlpha(colIndex) : 0;
    const r = blendChannel(cell.r, highlight?.r ?? cell.r, alpha);
    const g = blendChannel(cell.g, highlight?.g ?? cell.g, alpha);
    const b = blendChannel(cell.b, highlight?.b ?? cell.b, alpha);
    result += `\u001b[38;2;${r};${g};${b}m${cell.char}\u001b[39m`;
  }
  return result;
}

interface RGB {
  r: number;
  g: number;
  b: number;
}

function waveAlpha(rowIndex: number, colIndex: number, head: number): number {
  // Diagonal distance from the wave-head — gives a top-left-to-bottom-
  // right beam rather than a flat vertical wipe, so the animation reads
  // as more "magical" against the static dragon shape.
  const diagonal = rowIndex + colIndex;
  const distance = Math.abs(diagonal - head);
  if (distance >= SHIMMER_FADE_CELLS) return 0;
  // Cosine-style falloff so the wave-head feels softer than a sharp
  // linear ramp. 0 at the fade edge, 1 dead-on the wave-head.
  const linear = 1 - distance / SHIMMER_FADE_CELLS;
  return linear * linear;
}

function blendChannel(base: number, target: number, alpha: number): number {
  // Standard linear blend: out = base*(1-α) + target*α.
  // α=0 → keeps the cell's source colour. α=1 → fully highlight.
  return Math.round(base * (1 - alpha) + target * alpha);
}

function parseHexColor(input: string): RGB | undefined {
  if (!/^#?[0-9a-fA-F]{6}$/.test(input)) return undefined;
  const hex = input.startsWith('#') ? input.slice(1) : input;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

async function renderGrid(src: string, cellsW: number, cellsH: number): Promise<CellGrid> {
  const { default: sharp } = await import('sharp');
  const pixelW = cellsW * 2;
  const pixelH = cellsH * 4;
  const { data, info } = await sharp(src)
    .resize(pixelW, pixelH, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bg = sampleBackground(data, info.width, info.height, info.channels);
  return packGrid(data, info.width, info.height, info.channels, bg);
}

function sampleBackground(data: Buffer, width: number, height: number, channels: number): RGB {
  // Average the four corners. Splashes typically have a clean
  // background and any single-corner sample is brittle to JPEG-style
  // edge artifacts.
  const corners = [
    pixelAt(data, width, channels, 0, 0),
    pixelAt(data, width, channels, width - 1, 0),
    pixelAt(data, width, channels, 0, height - 1),
    pixelAt(data, width, channels, width - 1, height - 1),
  ];
  return {
    r: averageChannel(corners, 'r'),
    g: averageChannel(corners, 'g'),
    b: averageChannel(corners, 'b'),
  };
}

function pixelAt(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
): RGB & { a: number } {
  const offset = (y * width + x) * channels;
  return {
    r: data[offset] ?? 0,
    g: data[offset + 1] ?? 0,
    b: data[offset + 2] ?? 0,
    a: channels === 4 ? (data[offset + 3] ?? 255) : 255,
  };
}

function averageChannel(samples: readonly RGB[], channel: 'r' | 'g' | 'b'): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample[channel];
  return Math.round(sum / samples.length);
}

function packGrid(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
  bg: RGB,
): CellGrid {
  const grid: CellGrid = [];
  for (let y = 0; y + 3 < height; y += 4) {
    const row: Cell[] = [];
    for (let x = 0; x + 1 < width; x += 2) {
      row.push(packCell(data, width, channels, x, y, bg));
    }
    grid.push(row);
  }
  return grid;
}

function packCell(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
  bg: RGB,
): Cell {
  let pattern = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let onDots = 0;
  for (const { dx, dy, bit } of DOT_BITS) {
    const pixel = pixelAt(data, width, channels, x + dx, y + dy);
    if (!isForeground(pixel, bg)) continue;
    pattern |= 1 << bit;
    rSum += pixel.r;
    gSum += pixel.g;
    bSum += pixel.b;
    onDots += 1;
  }
  if (onDots === 0) {
    return { char: undefined, r: 0, g: 0, b: 0 };
  }
  return {
    char: String.fromCharCode(BRAILLE_BASE + pattern),
    r: Math.round(rSum / onDots),
    g: Math.round(gSum / onDots),
    b: Math.round(bSum / onDots),
  };
}

function isForeground(pixel: RGB & { a: number }, bg: RGB): boolean {
  if (pixel.a < 24) return false;
  const dr = pixel.r - bg.r;
  const dg = pixel.g - bg.g;
  const db = pixel.b - bg.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) > BG_THRESHOLD_DISTANCE;
}

export const __testing = {
  EMPTY_BRAILLE_GLYPH,
  parseHexColor,
  waveAlpha,
  blendChannel,
  isForeground,
  sampleBackground,
};
