import type { JsonObject } from './json.js';

export interface UiComponentDescriptor {
  id: string;
  kind: string;
  slot: string;
  title?: string;
  order?: number;
  visible?: boolean;
  props?: JsonObject;
}

export interface UiComponentSnapshot {
  descriptor: UiComponentDescriptor;
  state: JsonObject;
}
