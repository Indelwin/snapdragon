import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_SD_SESSION_ROOT } from '../config.js';
import type { SdProfileInfo } from '../profile.js';
import { type RenderImageOptions, renderImageFile } from './image-renderer.js';

/**
 * Resolution order for the splash artwork PNG:
 *
 * 1. The active profile's `splash.png` (when a profile is active).
 * 2. The user-level override at `~/.snapdragon/sd/splash.png`.
 * 3. A bundled default (not shipped today; the ASCII fallback in
 *    `splash.tsx` continues to render when nothing is found).
 *
 * We intentionally only return the *first* hit — the splash is a
 * single piece of art, not a stack.
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

export async function loadSplashImage(
  options: ResolveSplashImageOptions & { render?: RenderImageOptions } = {},
): Promise<string | undefined> {
  const path = resolveSplashImagePath(options);
  if (!path) return undefined;
  try {
    return await renderImageFile(path, options.render ?? defaultSplashRenderOptions());
  } catch {
    // Bad PNG, missing decoder, or terminal-image rejecting the file
    // shouldn't break startup — fall back to the ASCII art.
    return undefined;
  }
}

function defaultSdRoot(): string {
  return resolve(dirname(DEFAULT_SD_SESSION_ROOT));
}

function defaultSplashRenderOptions(): RenderImageOptions {
  // Splash art lives inside the bordered box in `splash.tsx`. ASCII
  // renders look chunkier and more iconic at lower resolutions —
  // every glyph then represents a meaningful chunk of source pixels
  // rather than a tiny pastel gradation that becomes visual noise.
  // 40 columns lands in the sweet spot for a recognisable square or
  // portrait splash on a typical 80–120 column terminal; the height
  // is auto-derived from the source aspect ratio.
  return { style: 'ascii', width: 40, preserveAspectRatio: true };
}
