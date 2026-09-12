import type { SessionContextChunkRecord } from './records.js';

export interface ContextFrontierState {
  active: Map<number, SessionContextChunkRecord>;
  maxChunkId: number;
}
