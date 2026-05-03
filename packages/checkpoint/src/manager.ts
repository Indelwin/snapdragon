import { diffAgainstCheckpoint } from './diff.js';
import { listCheckpointEntries } from './list.js';
import { checkpointContext } from './manager-context.js';
import { type ResolvedCheckpointOptions, resolveCheckpointOptions } from './manager-options.js';
import { getWorkingDirForPath } from './path-policy.js';
import { restoreCheckpoint } from './restore.js';
import { ensureSnapshot } from './snapshot.js';
import type { CheckpointDiffResult } from './types-diff.js';
import type { CheckpointEntry } from './types-entry.js';
import type { CheckpointManagerOptions } from './types-options.js';
import type { CheckpointRestoreResult } from './types-restore.js';

/**
 * Per-turn fail-quiet checkpoint manager.
 *
 * Lifecycle: call `newTurn()` at the start of each agent turn to clear the
 * dedup set, then `ensureCheckpoint(workTree, reason)` before any tool
 * call that might mutate the work tree.  Reads (`listCheckpoints`,
 * `diffCheckpoint`) and `restoreCheckpoint` are user-driven — typically
 * wired to a `/rollback` slash command.
 */
export class CheckpointManager {
  readonly #resolved: ResolvedCheckpointOptions;
  #checkpointedThisTurn = new Set<string>();

  constructor(options: CheckpointManagerOptions) {
    this.#resolved = resolveCheckpointOptions(options);
  }

  get enabled(): boolean {
    return this.#resolved.enabled;
  }

  newTurn(): void {
    this.#checkpointedThisTurn.clear();
  }

  /**
   * Snapshot `workTree` if we haven't already this turn.  Returns whether a
   * new snapshot was taken (false also covers "no changes since last
   * commit", "disabled", and "shadow repo init failed").
   */
  async ensureCheckpoint(workTree: string, reason: string): Promise<boolean> {
    if (!this.#resolved.enabled) return false;
    const ctx = await checkpointContext(this.#resolved, workTree);
    if (!ctx) return false;
    if (this.#checkpointedThisTurn.has(ctx.workTree)) return false;
    this.#checkpointedThisTurn.add(ctx.workTree);
    return ensureSnapshot(ctx.options, reason, this.#resolved.log);
  }

  ensureCheckpointForPath(filePath: string, reason: string): Promise<boolean> {
    return this.ensureCheckpoint(getWorkingDirForPath(filePath), reason);
  }

  async listCheckpoints(workTree: string): Promise<CheckpointEntry[]> {
    if (!this.#resolved.enabled) return [];
    const ctx = await checkpointContext(this.#resolved, workTree);
    if (!ctx) return [];
    return listCheckpointEntries(ctx.options, this.#resolved.maxSnapshots);
  }

  async diffCheckpoint(workTree: string, hash: string): Promise<CheckpointDiffResult> {
    if (!this.#resolved.enabled) return { success: false, error: 'checkpoints disabled' };
    const ctx = await checkpointContext(this.#resolved, workTree);
    if (!ctx) return { success: false, error: 'shadow repo unavailable' };
    return diffAgainstCheckpoint(ctx.options, hash);
  }

  async restoreCheckpoint(
    workTree: string,
    hash: string,
    options: { file?: string; preRollbackSnapshot?: boolean } = {},
  ): Promise<CheckpointRestoreResult> {
    if (!this.#resolved.enabled) return { success: false, error: 'checkpoints disabled' };
    const ctx = await checkpointContext(this.#resolved, workTree);
    if (!ctx) return { success: false, error: 'shadow repo unavailable' };
    return restoreCheckpoint({
      baseOptions: ctx.options,
      workTree: ctx.workTree,
      hash,
      file: options.file,
      preRollbackSnapshot: options.preRollbackSnapshot ?? true,
    });
  }
}
