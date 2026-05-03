import { runGit } from './git-env.js';
import type { BaseOpts, SnapshotResult, StageResult } from './snapshot-types.js';

export type { SnapshotResult } from './snapshot-types.js';

const ALLOWED_DIFF_QUIET_EXIT = new Set([1]);

/**
 * Take one snapshot: stage everything, bail out if there's nothing to
 * commit, otherwise commit with `reason` as the message.
 */
export async function takeSnapshot(baseOptions: BaseOpts, reason: string): Promise<SnapshotResult> {
  const staged = await stageAll(baseOptions);
  if (staged.error !== undefined) return { taken: false, error: staged.error };
  if (!staged.hasChanges) return { taken: false };

  const commitError = await commitStaged(baseOptions, sanitizeReason(reason));
  if (commitError !== undefined) return { taken: false, error: commitError };

  return { taken: true, hash: await readHead(baseOptions) };
}

/** Take a snapshot, routing any error through `log` instead of returning it. */
export async function ensureSnapshot(
  baseOptions: BaseOpts,
  reason: string,
  log: (message: string) => void,
): Promise<boolean> {
  const result = await takeSnapshot(baseOptions, reason);
  if (result.error !== undefined) log(`checkpoint: snapshot failed: ${result.error}`);
  return result.taken;
}

async function stageAll(baseOptions: BaseOpts): Promise<StageResult> {
  const add = await runGit(['add', '--all'], baseOptions);
  if (!add.ok) return { hasChanges: false, error: add.stderr || 'git add failed' };
  const probe = await runGit(['diff', '--cached', '--name-only'], {
    ...baseOptions,
    allowedExitCodes: ALLOWED_DIFF_QUIET_EXIT,
  });
  if (!probe.ok) return { hasChanges: false, error: probe.stderr || 'git diff probe failed' };
  return { hasChanges: probe.stdout.trim().length > 0 };
}

async function commitStaged(baseOptions: BaseOpts, message: string): Promise<string | undefined> {
  const commit = await runGit(
    ['commit', '--quiet', '--allow-empty-message', '-m', message],
    baseOptions,
  );
  return commit.ok ? undefined : commit.stderr || 'git commit failed';
}

async function readHead(baseOptions: BaseOpts): Promise<string | undefined> {
  const head = await runGit(['rev-parse', 'HEAD'], baseOptions);
  return head.ok ? head.stdout : undefined;
}

function sanitizeReason(reason: string): string {
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) return 'checkpoint';
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}
