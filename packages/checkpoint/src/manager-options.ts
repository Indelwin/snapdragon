import { resolve } from 'node:path';
import type { CheckpointManagerOptions } from './types-options.js';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_SNAPSHOTS = 50;

export interface ResolvedCheckpointOptions {
  enabled: boolean;
  baseDir: string;
  maxSnapshots: number;
  gitTimeoutMs: number;
  gitBinary: string;
  log: (message: string) => void;
}

export function resolveCheckpointOptions(
  options: CheckpointManagerOptions,
): ResolvedCheckpointOptions {
  return {
    enabled: options.enabled ?? false,
    baseDir: resolve(options.baseDir),
    maxSnapshots: options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS,
    gitTimeoutMs: options.gitTimeoutMs ?? DEFAULT_TIMEOUT_MS,
    gitBinary: options.gitBinary ?? 'git',
    log: options.log ?? noopLog,
  };
}

function noopLog(): void {
  // intentional no-op default
}
