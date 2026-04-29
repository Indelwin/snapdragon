---
'@snapdragon-ai/sd': minor
---

Replace the bold `SNAPDRAGON` text in the splash banner with a big
figlet-rendered ASCII title in a vertical pink → lilac gradient.

The new `<AsciiTitle>` component (`packages/sd/src/tui/renderers/
ascii-title.tsx`) wraps `figlet` directly and renders the result one
`<Text>` per line, with each line painted by linearly interpolating
across the supplied colour stops. Defaults to `Standard` font; the
splash uses `Slant` for a chunky, slightly italic look.

Skips the `ink-ascii` package — it's pinned to `ink ^2.6.0 / react
^16.12.0` and won't compose with our ink 7 / react 19 stack — but
it was just a thin wrapper around figlet anyway, so we're using
figlet directly.

Adds `figlet` and `@types/figlet` as dependencies.
