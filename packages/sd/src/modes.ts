import type { SdCliMode } from './args-types.js';

export type SdRunMode = Extract<SdCliMode, 'tui' | 'repl' | 'print'>;

const runModes = new Set<SdRunMode>(['tui', 'repl', 'print']);

export function isRunMode(raw: string): raw is SdRunMode {
  return runModes.has(raw as SdRunMode);
}

export function parseRunMode(value: string): SdRunMode {
  if (isRunMode(value)) return value;
  throw new Error(`Invalid --mode value: ${value}`);
}

export function modeFromBooleanFlag(flag: string): SdRunMode | undefined {
  const value = flag.slice(2);
  return isRunMode(value) ? value : undefined;
}
