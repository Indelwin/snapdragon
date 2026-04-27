import type { UiWorld } from '@snapdragon-ai/ui';

const CHAT_ID = 'sd.chat';

export function scrollChat(world: UiWorld, deltaRows: number): void {
  const state = world.componentState(CHAT_ID);
  const current = typeof state.scrollOffset === 'number' ? state.scrollOffset : 0;
  world.apply({
    type: 'ui.component.patch',
    id: CHAT_ID,
    patch: { scrollOffset: Math.max(0, current + deltaRows) },
  });
}

export function scrollChatToBottom(world: UiWorld): void {
  world.apply({ type: 'ui.component.patch', id: CHAT_ID, patch: { scrollOffset: 0 } });
}
