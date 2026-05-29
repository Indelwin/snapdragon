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
const MAX_MOUSE_INPUT_CHARS = 4096;
const INT = String.raw`\d{1,4}`;
const SGR_MOUSE_RE = new RegExp(`^(?:\\x1b?\\[<${INT};${INT};${INT}[Mm])+$`);
const SGR_MOUSE_FRAGMENT_RE = new RegExp(`^(?:${INT};${INT};${INT}[Mm])+$`);

export function isMouseSgrSequence(input: string): boolean {
  if (input.length < 4 || input.length > MAX_MOUSE_INPUT_CHARS) return false;
  return SGR_MOUSE_RE.test(input) || SGR_MOUSE_FRAGMENT_RE.test(input);
}
