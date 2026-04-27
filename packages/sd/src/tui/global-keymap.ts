import type { MutableRefObject } from 'react';
import { scrollChat, scrollChatToBottom } from './chat-scroll.js';
import type { PromptCompletionState } from './input-completion.js';
import type { KeyLike } from './input-keymap.js';
import type { PaletteState } from './palette-state.js';
import type { SdUiController } from './ui.js';

export function handleGlobalInput(
  input: string,
  key: KeyLike,
  args: {
    controller: SdUiController;
    exit: () => void;
    setDraft: (draft: string, completion?: PromptCompletionState) => void;
    setPalette: (patch: Partial<PaletteState>) => void;
    paletteRef: MutableRefObject<PaletteState>;
    historyIndexRef: MutableRefObject<number>;
  },
): boolean {
  if (key.ctrl && input === 'c') return runSync(args.exit);
  if (key.ctrl && input === 'e') return runSync(() => args.controller.toggleEventPanel());
  if (key.ctrl && input === 'u')
    return runSync(() => clearDraft(args.setDraft, args.historyIndexRef));
  if (key.pageUp) return runSync(() => scrollChat(args.controller.world, 10));
  if (key.pageDown) return runSync(() => scrollChat(args.controller.world, -10));
  if (key.end) return runSync(() => scrollChatToBottom(args.controller.world));
  if (key.ctrl && input === 'p') {
    return runSync(() =>
      args.setPalette({ open: !args.paletteRef.current.open, query: '', selectedIndex: 0 }),
    );
  }
  return false;
}

function clearDraft(
  setDraft: (draft: string) => void,
  historyIndexRef: MutableRefObject<number>,
): void {
  setDraft('');
  historyIndexRef.current = -1;
}

function runSync(fn: () => void): true {
  fn();
  return true;
}
