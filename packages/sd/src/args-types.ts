export type SdCliMode =
  | 'tui'
  | 'repl'
  | 'print'
  | 'help'
  | 'version'
  | 'setup'
  | 'list-sessions'
  | 'delete-session'
  | 'list-profiles';

export interface SdCliArgs {
  mode: SdCliMode;
  provider?: string;
  model?: string;
  cwd: string;
  configPath: string;
  sessionId?: string;
  deleteSessionId?: string;
  newSession: boolean;
  noSession: boolean;
  resume: boolean;
  profileName?: string;
  noProfile: boolean;
  profileRoot?: string;
  prompt?: string;
}
