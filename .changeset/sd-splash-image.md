---
'@snapdragon-ai/sd': minor
---

Add support for a custom `splash.png` rendered as TUI-style ASCII art
at startup. Resolution order (first hit wins):

1. `<active-profile-dir>/splash.png` — per-profile splash override.
2. `~/.snapdragon/sd/splash.png` — user-level override.

If neither exists, the existing ASCII cat banner continues to render.

Implementation notes:

- Uses [`ink-picture`](https://github.com/endernoke/ink-picture)'s
  `<Image>` component for the actual rendering, with `protocol="ascii"`
  forced so we get character-based art rather than the iTerm/Kitty
  graphics-protocol payloads that fight Ink's Yoga layout.
- `packages/sd/src/tui/splash-art.ts` resolves the file path; rendering
  is delegated entirely to the upstream component. The controller's
  `loadSplashArt()` is sync — it just patches the resolved path into
  splash state.
- The `TerminalInfoProvider` is scoped to the splash component only,
  so the rest of the TUI doesn't pay the terminal-capability detection
  cost — and test environments without a real stdin TTY don't get
  blocked on capability queries.
- `width={40}` keeps the splash chunky and iconic on a typical
  80–120-column terminal.

Adds `ink-picture@^1.3.5` as a dependency. Removes our home-grown
`image-renderer.ts` and the `terminal-image` dep alongside it.
