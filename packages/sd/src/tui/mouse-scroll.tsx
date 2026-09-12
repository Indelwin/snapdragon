import { useEffect } from 'react';
import { scrollChat } from './chat-scroll.js';
import type { SdMouseInputAdapter } from './mouse-input-adapter.js';
import type { SdUiController } from './ui.js';

/**
 * Translate coalesced wheel ticks from the raw input adapter into transcript
 * scrolling. Convention matches the keyboard bindings:
 *
 *   wheel up   → scrollChat(+rows)  — show older messages
 *   wheel down → scrollChat(-rows)  — toward the bottom (newest)
 *
 * Renders nothing.
 */
export function SdMouseScrollListener({
  controller,
  mouseInput,
  rowsPerTick = 3,
}: {
  controller: SdUiController;
  mouseInput?: SdMouseInputAdapter;
  rowsPerTick?: number;
}): null {
  useEffect(() => {
    if (!mouseInput) return;
    const unsubscribe = mouseInput.subscribeWheel((ticks) => {
      scrollChat(controller.world, ticks * rowsPerTick);
    });
    let deactivate: (() => void) | undefined;
    try {
      deactivate = mouseInput.activate();
    } catch (error) {
      unsubscribe();
      throw error;
    }
    return () => {
      unsubscribe();
      deactivate?.();
    };
  }, [mouseInput, controller, rowsPerTick]);
  return null;
}
