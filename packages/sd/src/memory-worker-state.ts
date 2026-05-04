import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { WorkerState } from './memory-worker-types.js';

export function readMemoryWorkerState(path: string): WorkerState {
  if (!existsSync(path)) return { version: 1, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as WorkerState;
    if (parsed?.version === 1 && parsed.sessions && typeof parsed.sessions === 'object') {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { version: 1, sessions: {} };
}

export function writeMemoryWorkerState(path: string, state: WorkerState): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, undefined, 2), 'utf8');
  renameSync(tmp, path);
}
