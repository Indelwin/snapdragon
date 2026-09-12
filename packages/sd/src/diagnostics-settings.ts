import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  SD_DIAGNOSTICS_INTERVAL_MS,
  SD_DIAGNOSTICS_MAX_FILE_BYTES,
  SD_DIAGNOSTICS_MAX_FILES,
  type SdDiagnosticsOptions,
} from './diagnostics-types.js';

export const DEFAULT_SD_DIAGNOSTICS_DIRECTORY = resolve(homedir(), '.snapdragon/sd/diagnostics');
export const SD_DIAGNOSTICS_FILENAME = 'metrics.jsonl';

export interface SdDiagnosticsWriterSettings {
  directory: string;
  path: string;
  intervalMs: number;
  maxFileBytes: number;
  maxFiles: number;
}

export function diagnosticsWriterSettings(
  options: SdDiagnosticsOptions,
): SdDiagnosticsWriterSettings {
  const directory = resolve(options.directory ?? DEFAULT_SD_DIAGNOSTICS_DIRECTORY);
  return {
    directory,
    path: join(directory, SD_DIAGNOSTICS_FILENAME),
    intervalMs: interval(options.intervalMs),
    maxFileBytes: boundedInteger(
      options.maxFileBytes,
      SD_DIAGNOSTICS_MAX_FILE_BYTES,
      4096,
      1 << 30,
    ),
    maxFiles: boundedInteger(options.maxFiles, SD_DIAGNOSTICS_MAX_FILES, 1, 16),
  };
}

function interval(value: number | undefined): number {
  if (value === 0) return 0;
  return boundedInteger(value, SD_DIAGNOSTICS_INTERVAL_MS, 10, 24 * 60 * 60 * 1000);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isInteger(value) && value !== undefined && value >= minimum && value <= maximum
    ? value
    : fallback;
}
