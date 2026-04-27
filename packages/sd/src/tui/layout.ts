import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';

export function fillsSlot(slot: string, component: UiComponentSnapshot): boolean {
  return slot === 'main' && component.descriptor.kind === 'chat.transcript';
}

export function fixedChromeRows(snapshot: UiWorldSnapshot): number {
  return statusRows(snapshot) + inputRows(snapshot) + footerRows(snapshot) + overlayRows(snapshot);
}

function statusRows(snapshot: UiWorldSnapshot): number {
  const runStatus = snapshot.components['sd.run-status']?.state ?? {};
  return 1 + (runStatus.usage || runStatus.error ? 1 : 0);
}

function inputRows(snapshot: UiWorldSnapshot): number {
  const prompt = snapshot.components['sd.prompt']?.state ?? {};
  const draft = typeof prompt.draft === 'string' ? prompt.draft : '';
  const attachments = Array.isArray(prompt.attachments) ? prompt.attachments.length : 0;
  return (
    1 + Math.max(1, draft.split('\n').length) + attachments + completionRows(prompt.completion)
  );
}

function completionRows(completion: unknown): number {
  if (!completion || typeof completion !== 'object' || Array.isArray(completion)) return 0;
  const suggestions = 'suggestions' in completion ? completion.suggestions : undefined;
  if (!Array.isArray(suggestions) || suggestions.length === 0) return 0;
  return Math.min(suggestions.length, 12) + 4;
}

function footerRows(snapshot: UiWorldSnapshot): number {
  return hasRenderableSlot('footer', snapshot) ? 1 : 0;
}

function overlayRows(snapshot: UiWorldSnapshot): number {
  const palette = snapshot.components['sd.palette']?.state ?? {};
  return palette.open === true ? 8 : 0;
}

function hasRenderableSlot(slot: string, snapshot: UiWorldSnapshot): boolean {
  return Object.values(snapshot.components).some(
    (component) => component.descriptor.slot === slot && component.descriptor.visible !== false,
  );
}
