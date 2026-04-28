import { Text } from 'ink';
import { useEffect, useState } from 'react';
import { tuiColors } from '../theme.js';

/**
 * Reusable visual effects for the running-state UI.
 *
 * `Spinner` is a frame cycler with a slowly breathing color, suitable
 * for inline use next to a label.
 *
 * `Shimmer` is a wave-of-brightness effect for static text — useful
 * for a "thinking..." placeholder that keeps the eye engaged without
 * shouting at the user.
 *
 * Both components own their own intervals and tear them down on
 * unmount, so they're safe to drop in and out of the tree as the
 * run-status flips.
 */

const DOTS_FRAMES: readonly string[] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const BREATHE_PALETTE: readonly string[] = [
  tuiColors.accent,
  tuiColors.accentSoft,
  tuiColors.accentPale,
  tuiColors.accentSoft,
];

export interface SpinnerProps {
  /** Frame interval in milliseconds. Defaults to a calm 90ms. */
  intervalMs?: number;
}

export function Spinner({ intervalMs = 90 }: SpinnerProps) {
  const tick = useTick(intervalMs);
  const frame = DOTS_FRAMES[tick % DOTS_FRAMES.length];
  const color = BREATHE_PALETTE[Math.floor(tick / 4) % BREATHE_PALETTE.length];
  return <Text color={color}>{frame}</Text>;
}

export interface ShimmerProps {
  text: string;
  /** Wave step interval. Defaults to 110ms for a relaxed cadence. */
  intervalMs?: number;
  /** Color used for the active wave head. */
  highlight?: string;
  /** Base text color (off-wave characters). */
  base?: string;
}

export function Shimmer({
  text,
  intervalMs = 110,
  highlight = tuiColors.accentSoft,
  base = tuiColors.muted,
}: ShimmerProps) {
  const tick = useTick(intervalMs);
  const period = Math.max(text.length + 4, 8);
  const head = tick % period;
  // The shimmer renders one <Text> per character of `text`; the
  // character set is fixed for the lifetime of this Shimmer instance
  // and only the per-character color animates, so using the character
  // index as the React key is intentional and stable.
  return (
    <Text>
      {text.split('').map((char, index) => {
        const distance = Math.abs(index - head);
        const color = shimmerColor(distance, highlight, base);
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: positional key is stable for fixed-length animated text
          <Text key={index} color={color} bold={distance === 0}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

function shimmerColor(distance: number, highlight: string, base: string): string {
  if (distance === 0) return highlight;
  if (distance === 1) return tuiColors.accent;
  if (distance === 2) return tuiColors.dim;
  return base;
}

function useTick(intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((value) => (value + 1) % 1_000_000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
