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
  return {
    options,
    result,
    statePath,
    state: readMemoryWorkerState(statePath),
    sessions: runtimeSessionStore(options.config)
      .list()
      .slice(0, workerCfg.lookback_sessions ?? 10),
    existingHashes: collectExistingHashes(memoryPath),
    includeAssistant: workerCfg.include_assistant ?? false,
  };
}
