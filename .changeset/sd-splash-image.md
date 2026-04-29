---
'@snapdragon-ai/sd': minor
---

Add support for a custom `splash.png` rendered as ANSI block-character
art at startup. Resolution order (first hit wins):

1. `<active-profile-dir>/splash.png` — per-profile splash override.
2. `~/.snapdragon/sd/splash.png` — user-level override.

If neither exists, the existing ASCII cat banner continues to render.

Implementation notes:

- New `packages/sd/src/tui/image-renderer.ts` wraps `terminal-image`
  with a small env-scrubber that forces the ANSI half-block fallback
  rather than letting it emit an iTerm/Kitty graphics-protocol payload.
  Protocol payloads do not play nicely inside Ink's Yoga layout — the
  image overlaps subsequent content because Yoga can't measure it. The
  scrub is restored in a `finally` so other code paths still see the
  real terminal.
- New `packages/sd/src/tui/splash-art.ts` resolves the path and
  renders the image to a string. Failures (missing file, decoder
  error, oversize image) are silently swallowed; the ASCII fallback
  remains.
- The TUI calls `controller.loadSplashArt()` once on mount; the
  rendered string lands in the splash component state under `image`,
  and `SplashBanner` renders it line-by-line via Ink `<Text>`.

Adds `terminal-image@^4.3.0` as a dependency.
