/**
 * Pluggable shell runner so tests can verify which subprocesses /reload
 * spawns without actually calling git/npm. The default runner uses
 * `child_process.spawn` (see `defaultReloadShellRunner`).
 */
export type ReloadShellRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<ReloadShellResult>;

export interface ReloadShellResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ReloadOptions {
  /** Run `git pull --ff-only` in the agent cwd before rebuilding. */
  pull?: boolean;
  /** Run the configured build command in the agent cwd before rebuilding. */
  build?: boolean;
  /**
   * Build command (split into argv). Defaults to `['npm', 'run', 'build']`.
   * Exposed primarily so a future config surface (e.g. `reload.build_command`)
   * can override it without changing this module.
   */
  buildCommand?: readonly [string, ...string[]];
  /** Override the shell runner (for tests). */
  runner?: ReloadShellRunner;
}

export interface ReloadStepReport {
  ok: boolean;
  /** Last few lines of combined stdout+stderr; useful tail when something fails. */
  tail: string;
}

export interface ReloadReport {
  pulled?: ReloadStepReport;
  built?: ReloadStepReport;
  extensions: number;
  extensionErrors: number;
  skills: number;
  profiles: number;
  services: number;
  provider: string;
  durationMs: number;
}
