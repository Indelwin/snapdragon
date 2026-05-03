/**
 * Detect xterm SGR mouse escape sequences emitted while mouse mode is on.
 *
 * `@zenobius/ink-mouse` enables `?1006` (SGR mouse) and listens to
 * `process.stdin` directly, but Ink's own `useInput` also sees the same
 * bytes. Ink strips the leading ESC and passes the remainder
 * (e.g. `[<64;10;5M`) into our prompt keymap, which would otherwise insert
 * the garbage into the user's draft. Filter it out at the entry point.
 *
 * Buttons we care about per the SGR mouse spec used by ink-mouse:
 * - `<0..3` — primary buttons / drag start
 * - `<32..35` — motion / drag
 * - `<64;` `<65;` — wheel up / wheel down
 *
 * Match conservatively: leading `[<`, integer button code, `;` digits `;`
 * digits, terminating `M` or `m`. Exported separately so it's trivially
 * unit-testable without spinning up Ink.
 */
const SGR_MOUSE_RE = /^\[<\d+;\d+;\d+[Mm]$/;

export function isMouseSgrSequence(input: string): boolean {
  if (input.length < 6 || input.length > 24) return false;
  return SGR_MOUSE_RE.test(input);
}
