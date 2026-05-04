import type { SdConfig } from './config.js';
import type { SdMemoryProvider } from './memory.js';
import type { SdProfileInfo } from './profile.js';

export interface WorkerState {
  version: 1;
  sessions: Record<string, { last_processed_at: number }>;
}

export interface SdMemoryWorkerOptions {
  config: SdConfig;
  memory: SdMemoryProvider;
  profile?: SdProfileInfo;
  /** Override "now" for tests. */
  now?(): number;
  /** Optional logger; defaults to no-op. */
  log?(line: string): void;
}

export interface SdMemoryWorkerScanResult {
  scanned_sessions: number;
  considered_messages: number;
  captured: number;
  skipped_duplicates: number;
  errors: string[];
}
