import type { SdCliArgs } from './args-types.js';

export interface SdRuntimeOptions {
  provider?: string;
  model?: string;
  cwd: string;
  configPath?: string;
  sessionId?: string;
  newSession?: boolean;
  noSession?: boolean;
  resume?: boolean;
  profileName?: string;
  noProfile?: boolean;
  profileRoot?: string;
  /** Skip starting the background memory worker (e.g. in tests or one-shots). */
  noMemoryWorker?: boolean;
  /** Skip starting any background services at all. */
  noBackground?: boolean;
  /** Override background execution for this process. */
  backgroundMode?: 'daemon' | 'inline' | 'off';
}

export function normalizeRuntimeOptions(args: SdRuntimeOptions | SdCliArgs): SdRuntimeOptions {
  return {
    provider: args.provider,
    model: args.model,
    cwd: args.cwd,
    configPath: args.configPath,
    sessionId: args.sessionId,
    newSession: args.newSession ?? false,
    noSession: args.noSession ?? false,
    resume: args.resume ?? false,
    profileName: args.profileName,
    noProfile: args.noProfile ?? false,
    profileRoot: args.profileRoot,
    noMemoryWorker: 'noMemoryWorker' in args ? args.noMemoryWorker : undefined,
    noBackground: 'noBackground' in args ? args.noBackground : undefined,
    backgroundMode: 'backgroundMode' in args ? args.backgroundMode : undefined,
  };
}
