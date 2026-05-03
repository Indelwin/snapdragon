import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * Build the env block we use for every git invocation against a shadow repo.
 *
 * The non-obvious bits:
 *   - `GIT_DIR` + `GIT_WORK_TREE`: shadow repo metadata lives in `shadowDir`
 *     while the work tree it tracks is the user's actual project.  No `.git`
 *     ever appears inside the project.
 *   - `GIT_CONFIG_GLOBAL=/dev/null` + `GIT_CONFIG_SYSTEM=/dev/null`
 *     + `GIT_CONFIG_NOSYSTEM=1`: a user with `commit.gpgsign = true` would
 *     otherwise get a GPG pinentry popup mid-tool-call.  Hooks, signing
 *     config, credential helpers — all neutralised.
 *   - `GIT_AUTHOR_*`/`GIT_COMMITTER_*`: deterministic identity so we never
 *     fail on "please tell me who you are".
 */
export function shadowGitEnv(shadowDir: string, workTree: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: shadowDir,
    GIT_WORK_TREE: workTree,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'snapdragon-checkpoint',
    GIT_AUTHOR_EMAIL: 'checkpoint@snapdragon.local',
    GIT_COMMITTER_NAME: 'snapdragon-checkpoint',
    GIT_COMMITTER_EMAIL: 'checkpoint@snapdragon.local',
    GIT_TERMINAL_PROMPT: '0',
  };
}

export interface GitRunOptions {
  shadowDir: string;
  workTree: string;
  timeoutMs: number;
  gitBinary: string;
  /**
   * Exit codes other than 0 that should still be treated as success.
   * Used for e.g. `git diff --quiet --cached` (1 = "there is a diff").
   */
  allowedExitCodes?: ReadonlySet<number>;
}

export interface GitRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a git subcommand with isolated config and a hard timeout.
 *
 * Uses `execFile` (not `shell: true`) so argv is never reinterpreted by a
 * shell — argument injection through e.g. a malicious commit hash is
 * impossible at this layer.
 */
export async function runGit(
  args: readonly string[],
  options: GitRunOptions,
): Promise<GitRunResult> {
  try {
    const { stdout, stderr } = await execFileP(options.gitBinary, args, {
      env: shadowGitEnv(options.shadowDir, options.workTree),
      timeout: options.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.toString().trim(), stderr: stderr.toString() };
  } catch (error) {
    return interpretError(error, options.allowedExitCodes);
  }
}

function interpretError(error: unknown, allowed?: ReadonlySet<number>): GitRunResult {
  const record = error as { code?: number; stdout?: Buffer | string; stderr?: Buffer | string };
  const stdout = (record.stdout ?? '').toString().trim();
  const stderr = (record.stderr ?? '').toString().trim();
  if (typeof record.code === 'number' && allowed?.has(record.code)) {
    return { ok: true, stdout, stderr };
  }
  return { ok: false, stdout, stderr };
}
