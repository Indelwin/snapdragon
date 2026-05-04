import type { SdCliArgs } from './args-types.js';

const booleanFlags = new Map<FlagName, keyof PickBooleanArgs>([
  ['--new-session', 'newSession'],
  ['--no-session', 'noSession'],
  ['--resume', 'resume'],
  ['--no-profile', 'noProfile'],
  ['--no-background', 'noBackground'],
  ['--no-memory-worker', 'noMemoryWorker'],
]);

type FlagName =
  | '--new-session'
  | '--no-session'
  | '--resume'
  | '--no-profile'
  | '--no-background'
  | '--no-memory-worker';

type PickBooleanArgs = Pick<
  SdCliArgs,
  'newSession' | 'noSession' | 'resume' | 'noProfile' | 'noBackground' | 'noMemoryWorker'
>;

export function applyBooleanFlag(out: SdCliArgs, flag: string): boolean {
  const key = booleanFlags.get(flag as FlagName);
  if (!key) return false;
  out[key] = true;
  return true;
}
