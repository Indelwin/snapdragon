import type { MutableRefObject } from 'react';
import { filterCommands, type SdTuiCommand } from './commands.js';
import {
  type DraftState,
  deleteBackwardChar,
  deleteBackwardWord,
  deleteForwardChar,
  insertAt,
  moveCharLeft,
  moveCharRight,
  moveLineEnd,
  moveLineStart,
  moveWordLeft,
  moveWordRight,
} from './draft-edit.js';
import {
  completePromptDraft,
  movePromptCompletion,
  type PromptCompletionCatalog,
  type PromptCompletionState,
  selectedPromptSuggestion,
} from './input-completion.js';
import type { PaletteState } from './palette-state.js';
import type { SdUiController } from './ui.js';

export { handleGlobalInput } from './global-keymap.js';
export type { PaletteState } from './palette-state.js';

export interface KeyLike {
  escape?: boolean;
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageUp?: boolean;
  pageDown?: boolean;
  end?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export interface SetDraftOptions {
  /** Cursor offset to set after applying `draft`. Defaults to `draft.length`. */
  cursor?: number;
  completion?: PromptCompletionState;
}

export type SetDraft = (draft: string, options?: SetDraftOptions) => void;

interface PromptInputArgs {
  draftRef: MutableRefObject<string>;
  cursorRef: MutableRefObject<number>;
  historyRef: MutableRefObject<string[]>;
  historyIndexRef: MutableRefObject<number>;
  historyDraftRef: MutableRefObject<string>;
  commandsRef: MutableRefObject<SdTuiCommand[]>;
  shellCommandsRef: MutableRefObject<string[]>;
  completionRef: MutableRefObject<PromptCompletionState | undefined>;
  completionCatalog: PromptCompletionCatalog;
  setDraft: SetDraft;
  submit: (draft: string) => Promise<void>;
}

export function handlePromptInput(input: string, key: KeyLike, args: PromptInputArgs): void {
  if (handlePromptControl(input, key, args)) return;
  if (handlePromptEditing(input, key, args)) return;
  if (input && !key.ctrl && !key.meta) insertText(args, input);
}

/**
 * Non-text-edit prompt keys: Enter (submit / newline), Tab (complete),
 * up/down (history or completion-list nav). Returns true when handled.
 */
function handlePromptControl(input: string, key: KeyLike, args: PromptInputArgs): boolean {
  if (key.return) {
    submitOrNewline(key, args);
    return true;
  }
  if (key.tab || input === '\t') {
    completePromptInput(
      args.draftRef.current,
      args.commandsRef.current,
      args.shellCommandsRef.current,
      args.completionRef.current,
      args.completionCatalog,
      args.setDraft,
    );
    return true;
  }
  if (key.upArrow) {
    if (moveCompletion(-1, args)) return true;
    applyHistory(-1, args);
    return true;
  }
  if (key.downArrow) {
    if (moveCompletion(1, args)) return true;
    applyHistory(1, args);
    return true;
  }
  return false;
}

/**
 * Cursor + delete keys. The matrix:
 *
 *   left/right arrow        — char movement
 *   meta+left/right         — word movement (Option+← on macOS terminals)
 *   ctrl+left/right         — word movement (Linux terminals / fallback)
 *   ctrl+a / ctrl+leftArrow — start of current line   (note: ctrl+a is free)
 *   meta+a / meta+e         — start / end of line     (alternates for keymaps
 *                              where ctrl+a/e are taken — currently ctrl+e
 *                              is the global event-panel toggle, so we don't
 *                              shadow it here)
 *   backspace               — delete char before cursor
 *   delete (forward)        — delete char at cursor
 *   meta+backspace          — delete word back        (ctrl+w-style)
 *
 * Returns true when handled.
 */
function handlePromptEditing(input: string, key: KeyLike, args: PromptInputArgs): boolean {
  if (key.leftArrow) {
    return applyEdit(args, key.meta || key.ctrl ? moveWordLeft : moveCharLeft);
  }
  if (key.rightArrow) {
    return applyEdit(args, key.meta || key.ctrl ? moveWordRight : moveCharRight);
  }
  if (key.backspace) {
    return applyEdit(args, key.meta ? deleteBackwardWord : deleteBackwardChar);
  }
  if (key.delete) {
    // Many terminals send Delete-key as `delete:true`, but some send it as
    // backspace. Treat `delete` as forward-delete only — backspace handles
    // backward.
    return applyEdit(args, deleteForwardChar);
  }
  // ctrl+a / ctrl+e style: start/end of current logical line. ctrl+e is
  // already a global keybind (event panel toggle) so it's skipped here;
  // we only bind ctrl+a → line-start and meta+e → line-end. ctrl+w deletes
  // the previous word for parity with readline.
  if (key.ctrl && input === 'a') return applyEdit(args, moveLineStart);
  if (key.meta && input === 'e') return applyEdit(args, moveLineEnd);
  if (key.ctrl && input === 'w') return applyEdit(args, deleteBackwardWord);
  return false;
}

function applyEdit(args: PromptInputArgs, op: (state: DraftState) => DraftState): true {
  const next = op({ text: args.draftRef.current, cursor: args.cursorRef.current });
  args.setDraft(next.text, { cursor: next.cursor });
  return true;
}

function insertText(args: PromptInputArgs, chunk: string): void {
  const next = insertAt({ text: args.draftRef.current, cursor: args.cursorRef.current }, chunk);
  args.setDraft(next.text, { cursor: next.cursor });
}

export async function handlePaletteInput(
  input: string,
  key: KeyLike,
  paletteRef: MutableRefObject<PaletteState>,
  setPalette: (patch: Partial<PaletteState>) => void,
  runPaletteSelection: () => Promise<void>,
): Promise<void> {
  if (key.escape) {
    setPalette({ open: false, query: '', selectedIndex: 0 });
    return;
  }
  if (key.return) {
    await runPaletteSelection();
    return;
  }
  if (key.upArrow) {
    setPalette({ selectedIndex: paletteRef.current.selectedIndex - 1 });
    return;
  }
  if (key.downArrow) {
    setPalette({ selectedIndex: paletteRef.current.selectedIndex + 1 });
    return;
  }
  if (key.backspace || key.delete) {
    setPalette({ query: paletteRef.current.query.slice(0, -1), selectedIndex: 0 });
    return;
  }
  if (input && !key.ctrl && !key.meta) {
    setPalette({ query: `${paletteRef.current.query}${input}`, selectedIndex: 0 });
  }
}

export function rememberHistory(
  line: string,
  historyRef: MutableRefObject<string[]>,
  controller: SdUiController,
): void {
  const next = [line, ...historyRef.current.filter((candidate) => candidate !== line)].slice(
    0,
    200,
  );
  historyRef.current = next;
  controller.setPromptHistory(next);
}

export function clampPalette(
  palette: PaletteState,
  commands: readonly SdTuiCommand[],
): PaletteState {
  const maxIndex = Math.max(0, filterCommands(commands, palette.query).length - 1);
  return { ...palette, selectedIndex: Math.max(0, Math.min(maxIndex, palette.selectedIndex)) };
}

function submitOrNewline(key: KeyLike, args: PromptInputArgs): void {
  // Newline insertion: shift+enter (when terminal supports CSI-u or kitty
  // protocol — otherwise the byte stream is identical to plain Enter and we
  // can't tell), or meta+enter (Option+Return on macOS), or ctrl+J (the
  // raw LF byte, which most terminals can produce). The fallback chain
  // means at least one of them works on any terminal.
  if (key.shift || key.meta) {
    insertText(args, '\n');
    return;
  }
  const selected = selectedPromptSuggestion(args.completionRef.current);
  if (selected && isSelectableCompletion(args.completionRef.current)) {
    args.setDraft('');
    void args.submit(selected.insertText);
    return;
  }
  const draft = args.draftRef.current;
  args.setDraft('');
  void args.submit(draft);
}

function moveCompletion(direction: -1 | 1, args: PromptInputArgs): boolean {
  const next = movePromptCompletion(args.completionRef.current, direction);
  if (!next) return false;
  // Don't disturb the cursor while navigating the completion list.
  args.setDraft(args.draftRef.current, { cursor: args.cursorRef.current, completion: next });
  return true;
}

function isSelectableCompletion(completion: PromptCompletionState | undefined): boolean {
  return (
    completion?.mode === 'provider' ||
    completion?.mode === 'model' ||
    completion?.mode === 'session' ||
    completion?.mode === 'profile'
  );
}

function applyHistory(direction: -1 | 1, args: PromptInputArgs): void {
  if (args.historyRef.current.length === 0) return;
  if (args.historyIndexRef.current < 0) args.historyDraftRef.current = args.draftRef.current;
  const next = Math.max(
    -1,
    Math.min(args.historyRef.current.length - 1, args.historyIndexRef.current - direction),
  );
  args.historyIndexRef.current = next;
  args.setDraft(next < 0 ? args.historyDraftRef.current : (args.historyRef.current[next] ?? ''));
}

function completePromptInput(
  draft: string,
  commands: readonly SdTuiCommand[],
  shellCommands: readonly string[],
  current: PromptCompletionState | undefined,
  catalog: PromptCompletionCatalog,
  setDraft: SetDraft,
): void {
  const next = completePromptDraft(draft, commands, shellCommands, current, catalog);
  if (next) setDraft(next.draft, { completion: next.completion });
}
