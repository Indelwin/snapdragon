import figlet from 'figlet';
import { Box, Text } from 'ink';
import { useEffect, useState } from 'react';
import { tuiColors } from '../theme.js';

/**
 * Multi-line figlet title with an optional vertical colour gradient.
 *
 * `figlet` ships with a generous catalogue of ASCII fonts. We render
 * the text once, then paint each line with a colour interpolated
 * across the supplied gradient stops — so a [pink, lilac] gradient
 * starts pink at the top and finishes lilac at the bottom.
 *
 * The ink-ascii package wraps figlet too but is pinned to ink 2 /
 * react 16, so we use figlet directly and keep the rendering Ink-
 * idiomatic (one `<Text>` per line, no raw escapes leaking through
 * Yoga).
 */
export interface AsciiTitleProps {
  text: string;
  /** Figlet font name. Defaults to `Standard`. */
  font?: figlet.Fonts;
  /**
   * Colour stops for the vertical gradient. With one stop the title
   * renders solid; with two or more, lines are interpolated linearly
   * top → bottom across the stops.
   */
  colors?: readonly string[];
  /** Render bold? Defaults to true for a chunkier title. */
  bold?: boolean;
}

export function AsciiTitle({
  text,
  font = 'Standard',
  colors = [tuiColors.accent],
  bold = true,
}: AsciiTitleProps) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    figlet.text(text, { font }, (error, rendered) => {
      if (cancelled) return;
      if (error || !rendered) {
        setLines([text]); // fall back to plain text
        return;
      }
      // figlet leaves trailing whitespace on every line and a hefty
      // gutter at the bottom; strip blank trailing lines so the
      // splash isn't padded out with empty rows.
      const trimmed = rendered.split('\n').map((line) => line.trimEnd());
      while (trimmed.length > 0 && trimmed.at(-1) === '') trimmed.pop();
      setLines(trimmed);
    });
    return () => {
      cancelled = true;
    };
  }, [text, font]);

  if (!lines) return null; // figlet is sync-ish but be safe with the placeholder

  return (
    <Box flexDirection="column">
      {lines.map((line, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length figlet output
          key={index}
          color={pickGradientColor(colors, lines.length, index)}
          bold={bold}
        >
          {line}
        </Text>
      ))}
    </Box>
  );
}

function pickGradientColor(colors: readonly string[], lineCount: number, index: number): string {
  if (colors.length === 0) return tuiColors.accent;
  if (colors.length === 1 || lineCount <= 1) return colors[0] ?? tuiColors.accent;
  // Map line index to a position in [0, colors.length-1] then linearly
  // blend between the two surrounding stops.
  const t = (index / (lineCount - 1)) * (colors.length - 1);
  const lower = Math.floor(t);
  const upper = Math.min(colors.length - 1, lower + 1);
  const frac = t - lower;
  const a = parseHexColor(colors[lower] ?? tuiColors.accent);
  const b = parseHexColor(colors[upper] ?? tuiColors.accent);
  if (!a || !b) return colors[lower] ?? tuiColors.accent;
  const r = Math.round(a.r + (b.r - a.r) * frac);
  const g = Math.round(a.g + (b.g - a.g) * frac);
  const blue = Math.round(a.b + (b.b - a.b) * frac);
  return `#${[r, g, blue].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function parseHexColor(input: string): { r: number; g: number; b: number } | undefined {
  if (!/^#?[0-9a-fA-F]{6}$/.test(input)) return undefined;
  const hex = input.startsWith('#') ? input.slice(1) : input;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}
