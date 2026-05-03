import type { GitRunOptions } from './git-env.js';

export interface SnapshotResult {
  taken: boolean;
  hash?: string;
  error?: string;
}

export interface StageResult {
  hasChanges: boolean;
  error?: string;
}

export type BaseOpts = Omit<GitRunOptions, 'allowedExitCodes'>;
