import type { UiComponentSnapshot, UiWorldSnapshot } from '@snapdragon-ai/ui';
import type { ReactNode } from 'react';

export interface InkRenderContext {
  snapshot: UiWorldSnapshot;
  viewportRows?: number;
}

export type InkRenderer = (component: UiComponentSnapshot, context: InkRenderContext) => ReactNode;

export class InkRendererRegistry {
  #renderers = new Map<string, InkRenderer>();

  register(kind: string, renderer: InkRenderer): void {
    this.#renderers.set(kind, renderer);
  }

  render(component: UiComponentSnapshot, context: InkRenderContext): ReactNode {
    const renderer = this.#renderers.get(component.descriptor.kind);
    return renderer ? renderer(component, context) : undefined;
  }
}
