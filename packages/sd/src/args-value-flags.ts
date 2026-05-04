import { resolve } from 'node:path';
import type { SdCliArgs } from './args-types.js';

const backgroundModes = new Set(['daemon', 'inline', 'off']);

const valueHandlers = new Map<string, (out: SdCliArgs, value: string) => void>([
  ['--provider', (out, value) => assign(out, 'provider', value)],
  ['--model', (out, value) => assign(out, 'model', value)],
  ['--cwd', (out, value) => assign(out, 'cwd', resolve(value))],
  ['--config', (out, value) => assign(out, 'configPath', resolve(value))],
  ['--session', (out, value) => assign(out, 'sessionId', value)],
  [
    '--delete-session',
    (out, value) => {
      assign(out, 'deleteSessionId', value);
      assign(out, 'mode', 'delete-session');
    },
  ],
  ['--profile', (out, value) => assign(out, 'profileName', value)],
  ['--background', (out, value) => assign(out, 'backgroundMode', parseBackgroundMode(value))],
]);

export function isValueFlag(flag: string): boolean {
  return valueHandlers.has(flag);
}

export function applyValueFlag(out: SdCliArgs, flag: string, value: string): void {
  const handler = valueHandlers.get(flag);
  if (!handler) throw new Error(`Unknown value option: ${flag}`);
  handler(out, value);
}

function assign<Key extends keyof SdCliArgs>(
  out: SdCliArgs,
  key: Key,
  value: SdCliArgs[Key],
): void {
  out[key] = value;
}

function parseBackgroundMode(value: string): SdCliArgs['backgroundMode'] {
  if (backgroundModes.has(value)) return value as SdCliArgs['backgroundMode'];
  throw new Error(`Invalid --background value: ${value}`);
}
