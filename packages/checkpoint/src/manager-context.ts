import { resolve } from 'node:path';
import type { GitRunOptions } from './git-env.js';
import type { ResolvedCheckpointOptions } from './manager-options.js';
import { initShadowRepo } from './shadow-repo.js';

export interface CheckpointContext {
  options: Omit<GitRunOptions, 'allowedExitCodes'>;
  workTree: string;
}

export async function checkpointContext(
  resolved: ResolvedCheckpointOptions,
  workTree: string,
): Promise<CheckpointContext | undefined> {
  const work = resolve(workTree);
  const init = await initShadowRepo({
    baseDir: resolved.baseDir,
    workTree: work,
    gitBinary: resolved.gitBinary,
    gitTimeoutMs: resolved.gitTimeoutMs,
  });
  if (!init.ok) {
    resolved.log(`checkpoint: shadow init failed for ${work}: ${init.error}`);
    return undefined;
  }
  return {
    options: gitOptions(resolved, init.shadowDir, work),
    workTree: work,
  };
}

export function gitOptions(
  resolved: ResolvedCheckpointOptions,
  shadowDir: string,
  workTree: string,
): Omit<GitRunOptions, 'allowedExitCodes'> {
  return {
    shadowDir,
    workTree,
    timeoutMs: resolved.gitTimeoutMs,
    gitBinary: resolved.gitBinary,
  };
}
