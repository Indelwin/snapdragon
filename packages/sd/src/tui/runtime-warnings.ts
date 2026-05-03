import type { SdRuntime } from '../runtime.js';
import { runtimeWarningLines } from '../runtime-warnings.js';
import type { ChatEntry } from './ui-entry.js';

export function runtimeWarningChatEntries(runtime: SdRuntime): ChatEntry[] {
  return runtimeWarningLines(runtime).map((content, index) => ({
    id: `runtime_warning_${index}`,
    role: 'system',
    content,
    isError: true,
  }));
}
