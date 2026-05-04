import type { UiComponentSnapshot } from './component-types.js';
import type { JsonObject } from './json.js';

export interface UiLogEntry {
  id: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  source?: string;
  data?: JsonObject;
}

export interface UiWorldSnapshot {
  revision: number;
  components: Record<string, UiComponentSnapshot>;
  focusId?: string;
  log: UiLogEntry[];
}

export type UiWorldListener = (snapshot: UiWorldSnapshot) => void;
