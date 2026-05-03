import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';

// Slot-kind pairs that should `flexGrow={1}` to fill remaining height. The
// `panel/event.log` entry stops the right-side column overflowing when both
// the tool panel and event log are open.
const FILLING_SLOTS = new Set<string>(['main::chat.transcript', 'panel::event.log']);

export function fillsSlot(slot: string, component: UiComponentSnapshot): boolean {
  return FILLING_SLOTS.has(`${slot}::${component.descriptor.kind}`);
}

export function fixedChromeRows(snapshot: UiWorldSnapshot): number {
  return statusRows(snapshot) + inputRows(snapshot) + footerRows(snapshot) + overlayRows(snapshot);
}

function statusRows(snapshot: UiWorldSnapshot): number {
  const s = snapshot.components['sd.run-status']?.state ?? {};
  return 1 + (s.usage || s.error ? 1 : 0);
}

function inputRows(snapshot: UiWorldSnapshot): number {
  const p = snapshot.components['sd.prompt']?.state ?? {};
  const draft = typeof p.draft === 'string' ? p.draft : '';
  const attachments = Array.isArray(p.attachments) ? p.attachments.length : 0;
  return 1 + Math.max(1, draft.split('\n').length) + attachments + completionRows(p.completion);
}

function completionRows(completion: unknown): number {
  if (!completion || typeof completion !== 'object' || Array.isArray(completion)) return 0;
  const suggestions = 'suggestions' in completion ? completion.suggestions : undefined;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;
  return Math.min(suggestions.length, 12) + 4;
}

function footerRows(snapshot: UiWorldSnapshot): number {
  const visible = Object.values(snapshot.components).some(
    (c) => c.descriptor.slot === 'footer' && c.descriptor.visible !== false,
  );
  return visible ? 1 : 0;
}

function overlayRows(snapshot: UiWorldSnapshot): number {
  return snapshot.components['sd.palette']?.state.open === true ? 8 : 0;
}
