import { resumeStartupSummary } from '../resume-summary.js';
import type { SdRuntime } from '../runtime.js';
import { runtimeWarningChatEntries } from './runtime-warnings.js';
import type { ChatEntry } from './ui-entry.js';

export function startupChatEntries(runtime: SdRuntime): ChatEntry[] {
  const resumed = resumeStartupSummary(runtime);
  return resumed
    ? [
        ...runtimeWarningChatEntries(runtime),
        { id: 'resume-summary', role: 'system', content: resumed },
      ]
    : runtimeWarningChatEntries(runtime);
}
