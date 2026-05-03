import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';

/**
 * Sorted, slot-scoped, visibility-filtered components from the world snapshot.
 *
 * Centralised here so the renderer (`tui-slot.tsx`) stays JSX-only and the
 * predicates have a single home with their tests.
 */
export function visibleComponentsForSlot(
  slot: string,
  snapshot: UiWorldSnapshot,
): UiComponentSnapshot[] {
  const out: UiComponentSnapshot[] = [];
  for (const component of Object.values(snapshot.components)) {
    if (isVisibleSlot(component, slot)) out.push(component);
  }
  return out.sort(compareComponents);
}

export function isVisibleSlot(component: UiComponentSnapshot, slot: string): boolean {
  if (component.descriptor.slot !== slot) return false;
  return component.descriptor.visible !== false;
}

function compareComponents(a: UiComponentSnapshot, b: UiComponentSnapshot): number {
  const byOrder = orderOf(a) - orderOf(b);
  if (byOrder !== 0) return byOrder;
  return a.descriptor.id.localeCompare(b.descriptor.id);
}

function orderOf(component: UiComponentSnapshot): number {
  const order = component.descriptor.order;
  return typeof order === 'number' ? order : 0;
}

export function hasRenderableSlot(slot: string, snapshot: UiWorldSnapshot): boolean {
  for (const component of Object.values(snapshot.components)) {
    if (!isVisibleSlot(component, slot)) continue;
    if (isRenderable(component)) return true;
  }
  return false;
}

function isRenderable(component: UiComponentSnapshot): boolean {
  if (component.descriptor.kind === 'event.log') return component.state.open === true;
  if (component.descriptor.kind === 'tool.panel') return isToolPanelRenderable(component);
  return true;
}

function isToolPanelRenderable(component: UiComponentSnapshot): boolean {
  if (component.state.open === false) return false;
  const tools = component.state.tools;
  if (!Array.isArray(tools)) return false;
  return tools.length > 0;
}
