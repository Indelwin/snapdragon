import { type GitRunOptions, runGit } from './git-env.js';
import { isValidCommitHash } from './path-policy.js';
import type { CheckpointDiffResult } from './types.js';

export async function diffAgainstCheckpoint(
  baseOptions: Omit<GitRunOptions, 'allowedExitCodes'>,
  hash: string,
): Promise<CheckpointDiffResult> {
  if (!isValidCommitHash(hash)) {
    return { success: false, error: 'invalid commit hash' };
  }
  const stat = await runGit(['diff', '--stat', hash], baseOptions);
  if (!stat.ok) return { success: false, error: stat.stderr || 'git diff --stat failed' };
  const diff = await runGit(['diff', hash], baseOptions);
  if (!diff.ok) return { success: false, error: diff.stderr || 'git diff failed' };
  return { success: true, stat: stat.stdout, diff: diff.stdout };
}
