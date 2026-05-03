import { type GitRunOptions, runGit } from './git-env.js';

const ALLOW_DIFF_EXIT = new Set([1]);
const ALLOW_COMMIT_EXIT = new Set([0]);

export interface SnapshotResult {
  taken: boolean;
  hash?: string;
  error?: string;
}

type BaseOpts = Omit<GitRunOptions, 'allowedExitCodes'>;

/**
 * Take one snapshot: stage everything, bail out if there's nothing to
 * commit, otherwise commit with `reason` as the message.  Returns the new
 * commit hash on success.
 */
export async function takeSnapshot(baseOptions: BaseOpts, reason: string): Promise<SnapshotResult> {
  const staged = await stageAll(baseOptions);
  if (staged.error) return { taken: false, error: staged.error };
  if (!staged.hasChanges) return { taken: false };

  const commitError = await commitStaged(baseOptions, reason);
  if (commitError) return { taken: false, error: commitError };

  return { taken: true, hash: await readHead(baseOptions) };
}

/**
 * Convenience wrapper used by the manager: take a snapshot and route any
 * error through `log` instead of returning it.
 */
export async function ensureSnapshot(
  baseOptions: BaseOpts,
  reason: string,
  log: (message: string) => void,
): Promise<boolean> {
  const result = await takeSnapshot(baseOptions, reason);
  if (result.error) log(`checkpoint: snapshot failed: ${result.error}`);
  return result.taken;
}

async function stageAll(baseOptions: BaseOpts): Promise<{ hasChanges: boolean; error?: string }> {
  const add = await runGit(['add', '--all'], baseOptions);
  if (!add.ok) return { hasChanges: false, error: add.stderr || 'git add failed' };
  const probe = await runGit(['diff', '--cached', '--name-only'], {
    ...baseOptions,
    allowedExitCodes: ALLOW_DIFF_EXIT,
  });
  if (!probe.ok) return { hasChanges: false, error: probe.stderr || 'git diff probe failed' };
  return { hasChanges: probe.stdout.trim().length > 0 };
}

async function commitStaged(baseOptions: BaseOpts, reason: string): Promise<string | undefined> {
  const commit = await runGit(
    ['commit', '--quiet', '--allow-empty-message', '-m', sanitizeReason(reason)],
    { ...baseOptions, allowedExitCodes: ALLOW_COMMIT_EXIT },
  );
  return commit.ok ? undefined : commit.stderr || 'git commit failed';
}

async function readHead(baseOptions: BaseOpts): Promise<string | undefined> {
  const head = await runGit(['rev-parse', 'HEAD'], baseOptions);
  return head.ok ? head.stdout : undefined;
}

function sanitizeReason(reason: string): string {
  const trimmed = reason.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'checkpoint';
  return trimmed.length > 200 ? `${trimmed.slice(0, 197)}...` : trimmed;
}
