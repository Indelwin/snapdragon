export interface CheckpointManagerOptions {
  /** Master switch — defaults to `false` to match the opt-in design. */
  enabled?: boolean;
  /** Soft cap for `listCheckpoints` log output. Default 50. */
  maxSnapshots?: number;
  /** Base directory for shadow repos. Required so callers control on-disk layout. */
  baseDir: string;
  /** Per-git-call timeout (ms). Default 30000. */
  gitTimeoutMs?: number;
  /** Path to `git` binary; defaults to `git` resolved on PATH. */
  gitBinary?: string;
  /** Optional debug logger. Receives a single string per event. */
  log?: (message: string) => void;
}
