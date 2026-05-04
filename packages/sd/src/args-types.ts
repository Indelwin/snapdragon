export type SdCliMode =
  | 'tui'
  | 'repl'
  | 'print'
  | 'help'
  | 'version'
  | 'setup'
  | 'list-sessions'
  | 'delete-session'
  | 'list-profiles'
  | 'daemon';

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
  backgroundMode?: 'daemon' | 'inline' | 'off';
  noBackground?: boolean;
  noMemoryWorker?: boolean;
  daemonAction?: 'run' | 'start' | 'stop' | 'status' | 'run-once';
  prompt?: string;
}
