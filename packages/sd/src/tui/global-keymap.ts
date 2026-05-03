import type { MutableRefObject } from 'react';
import { scrollChat, scrollChatToBottom } from './chat-scroll.js';
import type { KeyLike, SetDraft } from './input-keymap.js';
import { isMouseSgrSequence } from './mouse-sgr-filter.js';
import type { PaletteState } from './palette-state.js';
import type { SdUiController } from './ui.js';

export interface GlobalInputArgs {
  controller: SdUiController;
  exit: () => void;
  setDraft: SetDraft;
  setPalette: (patch: Partial<PaletteState>) => void;
  paletteRef: MutableRefObject<PaletteState>;
  historyIndexRef: MutableRefObject<number>;
}

export function handleGlobalInput(input: string, key: KeyLike, args: GlobalInputArgs): boolean {
  if (isMouseSgrSequence(input)) return true;
  if (handleExitOrCancel(input, key, args)) return true;
  if (handleScrollKeys(key, args.controller)) return true;
  return handleDraftAndPanelKeys(input, key, args);
}

function handleExitOrCancel(input: string, key: KeyLike, args: GlobalInputArgs): boolean {
  if (isCtrl(input, key, 'c')) return runSync(args.exit);
  if (isEscapeWithoutPalette(key, args.paletteRef)) {
    return runSync(() => args.controller.abortActiveRun());
  }
  return false;
}

function handleScrollKeys(key: KeyLike, controller: SdUiController): boolean {
  if (key.pageUp) return runSync(() => scrollChat(controller.world, 10));
  if (key.pageDown) return runSync(() => scrollChat(controller.world, -10));
  if (key.end) return runSync(() => scrollChatToBottom(controller.world));
  return false;
}

function handleDraftAndPanelKeys(input: string, key: KeyLike, args: GlobalInputArgs): boolean {
  if (!key.ctrl) return false;
  const action = CTRL_ACTIONS[input];
  if (!action) return false;
  return runSync(() => action(args));
}

const CTRL_ACTIONS: Record<string, (args: GlobalInputArgs) => void> = {
  e: (args) => args.controller.toggleEventPanel(),
  t: (args) => args.controller.toggleToolPanel(),
  u: (args) => clearDraft(args.setDraft, args.historyIndexRef),
  p: (args) => togglePalette(args),
};

function isCtrl(input: string, key: KeyLike, letter: string): boolean {
  return Boolean(key.ctrl) && input === letter;
}

function isEscapeWithoutPalette(key: KeyLike, paletteRef: MutableRefObject<PaletteState>): boolean {
  return Boolean(key.escape) && !paletteRef.current.open;
}

function togglePalette(args: GlobalInputArgs): void {
  args.setPalette({ open: !args.paletteRef.current.open, query: '', selectedIndex: 0 });
}

function clearDraft(setDraft: SetDraft, historyIndexRef: MutableRefObject<number>): void {
  setDraft('');
  historyIndexRef.current = -1;
}

function runSync(fn: () => void): true {
  fn();
  return true;
}
