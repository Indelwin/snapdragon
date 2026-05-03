import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runGit } from './git-env.js';

/**
 * Map an absolute working tree path to a stable shadow-repo directory under
 * `baseDir`.  We hash the absolute path so the layout is flat (no nested
 * dirs that mirror the user's filesystem) and length-bounded.
 */
export function shadowRepoPath(baseDir: string, workTree: string): string {
  const abs = resolve(workTree);
  const hash = createHash('sha256').update(abs).digest('hex').slice(0, 16);
  return join(baseDir, hash);
}

export interface InitShadowRepoOptions {
  baseDir: string;
  workTree: string;
  gitBinary: string;
  gitTimeoutMs: number;
}

export interface InitShadowRepoResult {
  ok: boolean;
  shadowDir: string;
  alreadyExisted: boolean;
  error?: string;
}

/**
 * Idempotently create a shadow git repo for `workTree`.  If the shadow dir
 * already contains a git repo we leave it alone; otherwise we `git init`
 * a bare-ish repo whose work tree points at the user's project.
 *
 * Returns shape rather than throws — checkpoint code is fail-quiet.
 */
export async function initShadowRepo(
  options: InitShadowRepoOptions,
): Promise<InitShadowRepoResult> {
  const shadowDir = shadowRepoPath(options.baseDir, options.workTree);
  try {
    mkdirSync(shadowDir, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      shadowDir,
      alreadyExisted: false,
      error: errorMessage(error),
    };
  }
  const probe = await runGit(['rev-parse', '--git-dir'], {
    shadowDir,
    workTree: options.workTree,
    timeoutMs: options.gitTimeoutMs,
    gitBinary: options.gitBinary,
  });
  if (probe.ok) return { ok: true, shadowDir, alreadyExisted: true };
  const init = await runGit(['init', '--quiet', shadowDir], {
    shadowDir,
    workTree: options.workTree,
    timeoutMs: options.gitTimeoutMs,
    gitBinary: options.gitBinary,
  });
  if (!init.ok) {
    return { ok: false, shadowDir, alreadyExisted: false, error: init.stderr || 'git init failed' };
  }
  return { ok: true, shadowDir, alreadyExisted: false };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
