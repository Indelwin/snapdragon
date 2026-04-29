---
'@snapdragon-ai/sd': minor
---

Add support for a custom `splash.png` rendered as colourful TUI-style
ASCII art at startup. Resolution order (first hit wins):

1. `<active-profile-dir>/splash.png` — per-profile splash override.
2. `~/.snapdragon/sd/splash.png` — user-level override.

If neither exists, the existing ASCII cat banner continues to render.

Implementation notes:

- New `packages/sd/src/tui/image-renderer.ts` ships two render styles:
  - `'ascii'` (default) — character-based ASCII art using a brightness
    ramp (` .:-=+*#%@`), each cell tinted with the source pixel's
    truecolor RGB. This is the TUI-friendly look — recognisable as art
    rather than a tiny photo, scales naturally to the terminal width.
  - `'blocks'` — half-block pixel rendering via `terminal-image`. Closer
    to a photo at higher cell densities; useful for future inline image
    rendering in the chat transcript.
- The blocks path scrubs `TERM_PROGRAM`/`KITTY_WINDOW_ID`/etc. for the
  duration of the render so `terminal-image` doesn't emit an
  iTerm/Kitty graphics-protocol payload (those break Ink's Yoga
  layout). The env is restored in a `finally`.
- New `packages/sd/src/tui/splash-art.ts` resolves the path and renders
  the image to a string. Default size is 64 columns wide with the
  height auto-derived from the source aspect ratio. Failures (missing
  file, decoder error, oversize image) are silently swallowed; the
  ASCII cat fallback remains.
- The TUI calls `controller.loadSplashArt()` once on mount; the
  rendered string lands in the splash component state under `image`,
  and `SplashBanner` renders it line-by-line via Ink `<Text>`.

Adds `terminal-image@^4.3.0` as a dependency (used today by the blocks
path; future PRs will use the same dep for inline image rendering in
chat).
