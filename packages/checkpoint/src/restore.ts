import { type GitRunOptions, runGit } from './git-env.js';
import { isValidCommitHash, relativeWithinWorkTree } from './path-policy.js';
import { takeSnapshot } from './snapshot.js';
import type { CheckpointRestoreResult } from './types.js';

export interface RestoreInput {
  baseOptions: Omit<GitRunOptions, 'allowedExitCodes'>;
  workTree: string;
  hash: string;
  /** When set, restore only this file (relative to `workTree`). */
  file?: string;
  /** When true, take a pre-rollback snapshot first. */
  preRollbackSnapshot: boolean;
}

export async function restoreCheckpoint(input: RestoreInput): Promise<CheckpointRestoreResult> {
  if (!isValidCommitHash(input.hash)) {
    return { success: false, error: 'invalid commit hash' };
  }
  const targetSpec = await resolveTarget(input);
  if ('error' in targetSpec) return { success: false, error: targetSpec.error };

  if (input.preRollbackSnapshot) {
    await takeSnapshot(input.baseOptions, `before rollback to ${input.hash.slice(0, 8)}`);
  }

  const checkout = await runGit(['checkout', input.hash, '--', targetSpec.spec], input.baseOptions);
  if (!checkout.ok) {
    return { success: false, error: checkout.stderr || 'git checkout failed' };
  }
  const reason = await readSubject(input);
  return {
    success: true,
    restoredTo: input.hash.slice(0, 8),
    reason,
    directory: input.workTree,
    file: input.file,
  };
}

type TargetSpec = { spec: string } | { error: string };

async function resolveTarget(input: RestoreInput): Promise<TargetSpec> {
  if (input.file === undefined) return { spec: '.' };
  const rel = relativeWithinWorkTree(input.workTree, input.file);
  if (rel === undefined) return { error: 'file path escapes work tree' };
  return { spec: rel };
}

async function readSubject(input: RestoreInput): Promise<string | undefined> {
  const result = await runGit(['log', '--format=%s', '-1', input.hash], input.baseOptions);
  return result.ok ? result.stdout : undefined;
}
