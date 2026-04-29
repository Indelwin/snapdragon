/**
 * Pure draft + cursor editing primitives for the TUI prompt. Kept free of
 * Ink/React imports so they're trivial to unit test. The cursor is a
 * UTF-16 offset into `text`: `cursor === 0` is before the first code unit,
 * `cursor === text.length` is after the last. Word boundaries are
 * detected via a simple "transition between word and non-word character"
 * rule that matches what most readline-style editors do.
 */
export interface DraftState {
  text: string;
  cursor: number;
}

const WORD_RE = /[\p{L}\p{N}_]/u;

export function clampCursor(text: string, cursor: number): number {
  if (cursor < 0) return 0;
  if (cursor > text.length) return text.length;
  return cursor;
}

export function insertAt(state: DraftState, chunk: string): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  const next = `${state.text.slice(0, cursor)}${chunk}${state.text.slice(cursor)}`;
  return { text: next, cursor: cursor + chunk.length };
}

export function deleteBackwardChar(state: DraftState): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  if (cursor === 0) return state;
  return {
    text: `${state.text.slice(0, cursor - 1)}${state.text.slice(cursor)}`,
    cursor: cursor - 1,
  };
}

export function deleteForwardChar(state: DraftState): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  if (cursor >= state.text.length) return state;
  return {
    text: `${state.text.slice(0, cursor)}${state.text.slice(cursor + 1)}`,
    cursor,
  };
}

export function deleteBackwardWord(state: DraftState): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  if (cursor === 0) return state;
  const target = wordBoundaryLeft(state.text, cursor);
  return {
    text: `${state.text.slice(0, target)}${state.text.slice(cursor)}`,
    cursor: target,
  };
}

export function moveCharLeft(state: DraftState): DraftState {
  return { ...state, cursor: clampCursor(state.text, state.cursor - 1) };
}

export function moveCharRight(state: DraftState): DraftState {
  return { ...state, cursor: clampCursor(state.text, state.cursor + 1) };
}

export function moveWordLeft(state: DraftState): DraftState {
  return { ...state, cursor: wordBoundaryLeft(state.text, state.cursor) };
}

export function moveWordRight(state: DraftState): DraftState {
  return { ...state, cursor: wordBoundaryRight(state.text, state.cursor) };
}

export function moveLineStart(state: DraftState): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  // Walk backward until we hit a newline or the start of the text. The
  // resulting cursor sits AFTER the newline (or at 0).
  let i = cursor;
  while (i > 0 && state.text[i - 1] !== '\n') i -= 1;
  return { ...state, cursor: i };
}

export function moveLineEnd(state: DraftState): DraftState {
  const cursor = clampCursor(state.text, state.cursor);
  let i = cursor;
  while (i < state.text.length && state.text[i] !== '\n') i += 1;
  return { ...state, cursor: i };
}

/**
 * "Word back" boundary: skip any non-word characters immediately before the
 * cursor, then skip the word characters. Mirrors readline's M-b / Option+←.
 */
export function wordBoundaryLeft(text: string, cursor: number): number {
  let i = clampCursor(text, cursor);
  while (i > 0 && !isWordChar(text[i - 1])) i -= 1;
  while (i > 0 && isWordChar(text[i - 1])) i -= 1;
  return i;
}

export function wordBoundaryRight(text: string, cursor: number): number {
  let i = clampCursor(text, cursor);
  while (i < text.length && !isWordChar(text[i])) i += 1;
  while (i < text.length && isWordChar(text[i])) i += 1;
  return i;
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_RE.test(ch);
}

/**
 * Locate the cursor on a wrapped grid: returns the line index (0-based)
 * and column offset within that line. Splits on `\n` only; visual wrapping
 * is the renderer's job.
 */
export function locateCursor(text: string, cursor: number): { line: number; column: number } {
  const c = clampCursor(text, cursor);
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < c; i += 1) {
    if (text[i] === '\n') {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: c - lineStart };
}
