import type { SdRuntime } from '../runtime.js';
import { listRuntimeSessions } from '../runtime-session.js';

export function countSessionsSafely(runtime: SdRuntime): number {
  try {
    return listRuntimeSessions(runtime.config).length;
  } catch {
    return 0;
  }
}

export function countMemoriesSafely(runtime: SdRuntime): number {
  try {
    const result = runtime.memory.read();
    return result instanceof Promise ? 0 : result.entries.length;
  } catch {
    return 0;
  }
}
