import { MouseProvider, useMouse } from '@zenobius/ink-mouse';
import { type ReactNode, useEffect } from 'react';
import { scrollChat } from './chat-scroll.js';
import type { SdUiController } from './ui.js';

/**
 * Wrap the Ink tree so descendants can subscribe to mouse events.
 *
 * Mouse mode is controlled by `tui.mouse.enabled` (default true). When the
 * provider is mounted, ink-mouse writes the xterm DECSET sequences to enable
 * SGR mouse reporting and listens to stdin directly. We additionally filter
 * the resulting `\x1b[<…M` byte sequences out of Ink's `useInput` stream
 * (see `mouse-sgr-filter.ts`) so they don't leak into the prompt draft.
 */
export function SdMouseProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}): ReactNode {
  // Skip the ink-mouse provider when not viable: disabled, no TTY (CI / piped
  // input), or running under `node --test` / ink-testing-library (ink-mouse
  // installs stdin listeners on real process.stdin which interferes with
  // test rendering and clean exits).
  if (!enabled || !mouseProviderViable()) return children;
  return <MouseProvider>{children}</MouseProvider>;
}

/**
 * Listen for wheel events anywhere in the terminal and translate them into
 * chat-transcript scrolls. Convention matches the keyboard bindings:
 *
 *   wheel up   → scrollChat(+rows)  — show older messages
 *   wheel down → scrollChat(-rows)  — toward the bottom (newest)
 *
 * Renders nothing.
 */
export function SdMouseScrollListener({
  controller,
  rowsPerTick = 3,
  enabled = true,
}: {
  controller: SdUiController;
  rowsPerTick?: number;
  enabled?: boolean;
}): null {
  const active = enabled && mouseProviderViable();
  const mouse = useMouse();
  useEffect(() => {
    if (!active || !mouse) return;
    const onScroll = (_position: { x: number; y: number }, direction: unknown) => {
      if (direction === 'scrollup') scrollChat(controller.world, rowsPerTick);
      else if (direction === 'scrolldown') scrollChat(controller.world, -rowsPerTick);
    };
    mouse.events.on('scroll', onScroll);
    return () => {
      mouse.events.off('scroll', onScroll);
    };
  }, [active, mouse, controller, rowsPerTick]);
  return null;
}

function mouseProviderViable(): boolean {
  const stdin = process.stdin as NodeJS.ReadStream & { isTTY?: boolean };
  if (!stdin.isTTY) return false;
  if (typeof stdin.setRawMode !== 'function') return false;
  if (process.env.NODE_TEST_CONTEXT) return false;
  return true;
}
