import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const DEFAULT_SD_SESSION_INDEX_PATH = resolve(
  homedir(),
  '.snapdragon/sd/sessions/index.sqlite',
);

export interface SdSessionIndexConfig {
  enabled?: boolean;
  path?: string;
  /** How often the background service syncs the index from JSONL. Default 60000. */
  interval_ms?: number;
}

export function defaultSessionIndexConfig(): SdSessionIndexConfig {
  return {
    enabled: true,
    interval_ms: 60_000,
  };
}

export function mergeSessionIndexConfig(
  defaults: SdSessionIndexConfig | undefined,
  input: SdSessionIndexConfig | undefined,
): SdSessionIndexConfig {
  return { ...(defaults ?? {}), ...(input ?? {}) };
}
