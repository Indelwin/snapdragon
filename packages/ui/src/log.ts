import { cloneData } from './clone.js';
import type { UiLogEntry } from './world-types.js';

export function appendBoundedLog(
  log: UiLogEntry[],
  entry: UiLogEntry,
  maxEntries: number,
): UiLogEntry[] {
  const next = [...log, cloneData(entry)];
  return next.length > maxEntries ? next.slice(-maxEntries) : next;
}
