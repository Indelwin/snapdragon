import type { SdRuntime } from './runtime.js';
import { summarizeSession } from './session-summary.js';

export function resumeStartupSummary(runtime: SdRuntime): string | undefined {
  if (!runtime.options.resume || !runtime.session) return undefined;
  const summary = summarizeSession(runtime.session);
  if (summary.messages === 0) return undefined;
  return `Resumed ${summary.id}: ${summary.title ?? 'Untitled session'} (${summary.messages} messages).`;
}
