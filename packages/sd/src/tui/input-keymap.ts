import type { MutableRefObject } from 'react';
import { filterCommands, type SdTuiCommand } from './commands.js';
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

export function handlePromptInput(
  input: string,
  key: KeyLike,
  args: {
    draftRef: MutableRefObject<string>;
    historyRef: MutableRefObject<string[]>;
    historyIndexRef: MutableRefObject<number>;
    historyDraftRef: MutableRefObject<string>;
    commandsRef: MutableRefObject<SdTuiCommand[]>;
    shellCommandsRef: MutableRefObject<string[]>;
    completionRef: MutableRefObject<PromptCompletionState | undefined>;
    completionCatalog: PromptCompletionCatalog;
    setDraft: (draft: string, completion?: PromptCompletionState) => void;
    submit: (draft: string) => Promise<void>;
  },
): void {
  if (key.return) {
    submitOrNewline(key, args.draftRef, args.completionRef, args.setDraft, args.submit);
    return;
  }
  if (key.backspace || key.delete) {
    args.setDraft(args.draftRef.current.slice(0, -1));
    return;
  }
  if (key.upArrow) {
    if (moveCompletion(-1, args)) return;
    applyHistory(-1, args);
    return;
  }
  if (key.downArrow) {
    if (moveCompletion(1, args)) return;
    applyHistory(1, args);
    return;
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
    return;
  }
  if (input && !key.ctrl && !key.meta) args.setDraft(`${args.draftRef.current}${input}`);
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

function submitOrNewline(
  key: KeyLike,
  draftRef: MutableRefObject<string>,
  completionRef: MutableRefObject<PromptCompletionState | undefined>,
  setDraft: (draft: string, completion?: PromptCompletionState) => void,
  submit: (draft: string) => Promise<void>,
): void {
  if (key.shift || key.meta) {
    setDraft(`${draftRef.current}\n`);
    return;
  }
  const selected = selectedPromptSuggestion(completionRef.current);
  if (selected && isSelectableCompletion(completionRef.current)) {
    setDraft('');
    void submit(selected.insertText);
    return;
  }
  const draft = draftRef.current;
  setDraft('');
  void submit(draft);
}

function moveCompletion(
  direction: -1 | 1,
  args: {
    draftRef: MutableRefObject<string>;
    completionRef: MutableRefObject<PromptCompletionState | undefined>;
    setDraft: (draft: string, completion?: PromptCompletionState) => void;
  },
): boolean {
  const next = movePromptCompletion(args.completionRef.current, direction);
  if (!next) return false;
  args.setDraft(args.draftRef.current, next);
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

function applyHistory(
  direction: -1 | 1,
  args: {
    draftRef: MutableRefObject<string>;
    historyRef: MutableRefObject<string[]>;
    historyIndexRef: MutableRefObject<number>;
    historyDraftRef: MutableRefObject<string>;
    setDraft: (draft: string) => void;
  },
): void {
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
  setDraft: (draft: string, completion?: PromptCompletionState) => void,
): void {
  const next = completePromptDraft(draft, commands, shellCommands, current, catalog);
  if (next) setDraft(next.draft, next.completion);
}
