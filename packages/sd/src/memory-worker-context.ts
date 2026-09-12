import { dirname, join } from 'node:path';
import type { SdConfig } from './config.js';
import { resolveSdMemoryPath } from './memory.js';
import { readMemoryWorkerState } from './memory-worker-state.js';
import { collectExistingHashes } from './memory-worker-text.js';
import type {
  SdMemoryWorkerOptions,
  SdMemoryWorkerScanResult,
  WorkerState,
} from './memory-worker-types.js';
import { runtimeSessionStore } from './runtime-session.js';

const STATE_FILENAME = '.worker-state.json';

export type MemoryWorkerSession = ReturnType<
  ReturnType<typeof runtimeSessionStore>['list']
>[number];

export interface MemoryWorkerScanContext {
  options: SdMemoryWorkerOptions;
  result: SdMemoryWorkerScanResult;
  statePath: string;
  state: WorkerState;
  sessions: MemoryWorkerSession[];
  existingHashes: Set<string>;
  includeAssistant: boolean;
  remainingRecords: number;
  remainingBytes: number;
}

export function memoryWorkerDisabled(config: SdConfig): boolean {
  const memoryConfig = config.memory;
  return memoryConfig?.enabled === false || memoryConfig?.authoring === false;
}

export function memoryWorkerScanContext(
  options: SdMemoryWorkerOptions,
  result: SdMemoryWorkerScanResult,
): MemoryWorkerScanContext {
  const workerCfg = options.config.memory?.worker ?? {};
  const memoryPath = resolveSdMemoryPath(options.config, options.profile);
  const statePath = join(dirname(memoryPath), STATE_FILENAME);
  const state = readMemoryWorkerState(statePath);
  const sessions = runtimeSessionStore(options.config)
    .list()
    .slice(0, workerCfg.lookback_sessions ?? 10);
  return {
    options,
    result,
    statePath,
    state,
    sessions: rotateSessions(sessions, state.next_session_id),
    existingHashes: collectExistingHashes(memoryPath),
    includeAssistant: workerCfg.include_assistant ?? false,
    remainingRecords: positiveBudget(workerCfg.max_records_per_pass, 500),
    remainingBytes: positiveBudget(workerCfg.max_bytes_per_pass, 4 * 1024 * 1024),
  };
}

function rotateSessions(
  sessions: MemoryWorkerSession[],
  nextSessionId: string | undefined,
): MemoryWorkerSession[] {
  const start = nextSessionId
    ? sessions.findIndex((session) => session.session_id === nextSessionId)
    : 0;
  if (start <= 0) return sessions;
  return [...sessions.slice(start), ...sessions.slice(0, start)];
}

function positiveBudget(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
