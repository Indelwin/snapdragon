import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';

/**
 * Tinted braille image renderer.
 *
 * `ink-picture`'s `BrailleImage` produces beautiful high-resolution
 * monochrome output (each glyph packs a 2×4 pixel grid via Unicode
 * Braille codepoints U+2800–U+28FF), but it ships a fixed black-on-
 * default-bg colour scheme. This component runs the same bit-packing
 * algorithm via `sharp` (already in our tree as a transitive dep of
 * `ink-picture`), then wraps each rendered row in a coloured Ink
 * `<Text>` so the whole image takes on a uniform tint — perfect for
 * the splash where we want it to read as part of the SD theme rather
 * than as a B/W foreign body.
 */
export interface ColoredBrailleImageProps {
  /** Path to a PNG/JPEG/etc. supported by sharp. */
  src: string;
  /** Output width in terminal cells. */
  width: number;
  /** Output height in terminal cells. */
  height: number;
  /** Foreground colour for the rendered braille glyphs. */
  color: string;
  /** Placeholder text shown while the image is decoding. */
  alt?: string;
}

const BRAILLE_BASE = 0x2800;

// Bit positions of the 8 dots within a Unicode Braille pattern.
// Matches ink-picture's `Braille.js` — dots 1..6 fill the top three
// rows, dots 7/8 fill the bottom row, columns 0/1 alternate.
const DOT_BITS = [
  { dx: 0, dy: 0, bit: 0 }, // dot 1
  { dx: 0, dy: 1, bit: 1 }, // dot 2
  { dx: 0, dy: 2, bit: 2 }, // dot 3
  { dx: 1, dy: 0, bit: 3 }, // dot 4
  { dx: 1, dy: 1, bit: 4 }, // dot 5
  { dx: 1, dy: 2, bit: 5 }, // dot 6
  { dx: 0, dy: 3, bit: 6 }, // dot 7
  { dx: 1, dy: 3, bit: 7 }, // dot 8
] as const;

export function ColoredBrailleImage({ src, width, height, color, alt }: ColoredBrailleImageProps) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rendered = await renderBraille(src, width, height);
        if (!cancelled) setLines(rendered);
      } catch {
        if (!cancelled) setLines(['']);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src, width, height]);

  if (!lines) {
    return <Text color={color}>{alt ?? 'loading…'}</Text>;
  }
  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length rendered braille
        <Text key={index} color={color}>
          {line}
        </Text>
      ))}
    </Box>
  );
}

async function renderBraille(src: string, cellsW: number, cellsH: number): Promise<string[]> {
  const { default: sharp } = await import('sharp');
  // Each cell is a 2×4 dot grid, so we sample at 2× width / 4× height.
  const pixelW = cellsW * 2;
  const pixelH = cellsH * 4;
  const { data, info } = await sharp(src)
    .resize(pixelW, pixelH, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return packBraille(data, info.width, info.height, info.channels);
}

function packBraille(data: Buffer, width: number, height: number, channels: number): string[] {
  const lines: string[] = [];
  for (let y = 0; y + 3 < height; y += 4) {
    let line = '';
    for (let x = 0; x + 1 < width; x += 2) {
      let pattern = 0;
      for (const { dx, dy, bit } of DOT_BITS) {
        if (isDotOn(data, width, channels, x + dx, y + dy)) pattern |= 1 << bit;
      }
      line += String.fromCharCode(BRAILLE_BASE + pattern);
    }
    lines.push(line);
  }
  return lines;
}

function isDotOn(data: Buffer, width: number, channels: number, x: number, y: number): boolean {
  const offset = (y * width + x) * channels;
  const r = data[offset] ?? 0;
  const g = data[offset + 1] ?? 0;
  const b = data[offset + 2] ?? 0;
  const a = channels === 4 ? (data[offset + 3] ?? 255) : 255;
  // ITU-R BT.709 relative luminance, alpha-blended toward "white" so
  // transparent regions don't draw a dot. Threshold at ~50% — same
  // policy as ink-picture so the braille shapes look the same.
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const blended = (luminance * a + 255 * (255 - a)) / 255;
  return blended > 128;
}
