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
  };
}
