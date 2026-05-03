import { type GitRunOptions, runGit } from './git-env.js';
import type { CheckpointEntry } from './types.js';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT = `%H${FIELD_SEP}%h${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`;

export async function listCheckpointEntries(
  options: Omit<GitRunOptions, 'allowedExitCodes'>,
  limit: number,
): Promise<CheckpointEntry[]> {
  const result = await runGit(
    ['log', `--format=${FORMAT}`, `-n`, String(Math.max(1, limit))],
    options,
  );
  if (!result.ok) return [];
  return parseLogOutput(result.stdout);
}

function parseLogOutput(stdout: string): CheckpointEntry[] {
  return stdout
    .split(RECORD_SEP)
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map(parseRecord)
    .filter((entry): entry is CheckpointEntry => entry !== undefined);
}

function parseRecord(record: string): CheckpointEntry | undefined {
  const parts = record.split(FIELD_SEP);
  if (parts.length < 4) return undefined;
  const [hash, shortHash, timestamp, reason] = parts;
  if (!hash || !shortHash || !timestamp) return undefined;
  return { hash, shortHash, timestamp, reason: reason ?? '' };
}
