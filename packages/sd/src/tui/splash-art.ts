import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_SD_SESSION_ROOT } from '../config.js';
import type { SdProfileInfo } from '../profile.js';

/**
 * Resolution order for the splash artwork PNG:
 *
 * 1. The active profile's `splash.png` (when a profile is active).
 * 2. The user-level override at `~/.snapdragon/sd/splash.png`.
 *
 * If neither exists the splash falls back to the bundled ASCII cat
 * banner. We intentionally only return the *first* hit — the splash
 * is a single piece of art, not a stack.
 *
 * Rendering is delegated to `ColoredBrailleImage` in `splash.tsx`.
 * This module resolves paths only; the renderer uses sharp for sampling.
 */
export interface ResolveSplashImageOptions {
  profile?: SdProfileInfo;
  /**
   * Root directory for global sd config. Defaults to the parent of
   * `DEFAULT_SD_SESSION_ROOT` (i.e. `~/.snapdragon/sd`).
   */
  sdRoot?: string;
}

export const SPLASH_FILENAME = 'splash.png';

export function resolveSplashImagePath(
  options: ResolveSplashImageOptions = {},
): string | undefined {
  const candidates: string[] = [];
  if (options.profile?.dir) candidates.push(join(options.profile.dir, SPLASH_FILENAME));
  candidates.push(join(options.sdRoot ?? defaultSdRoot(), SPLASH_FILENAME));
  return candidates.find((candidate) => existsSync(candidate));
}

function defaultSdRoot(): string {
  return resolve(dirname(DEFAULT_SD_SESSION_ROOT));
}
