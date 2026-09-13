import { resumeStartupSummary } from './resume-summary.js';
import type { SdRuntime } from './runtime.js';
import { runtimeWarningLines } from './runtime-warnings.js';

export function replHeader(runtime: SdRuntime): string {
  const session = runtime.session ? `session ${runtime.session.sessionId}` : 'no session';
  const profile = runtime.profile ? `profile ${runtime.profile.name}` : 'no profile';
  const resumed = resumeStartupSummary(runtime);
  return [
    `sd ${runtime.provider.id}/${runtime.provider.model} (${session}, ${profile})`,
    ...runtimeWarningLines(runtime),
    ...(resumed ? [resumed] : []),
    'Type /help for commands.',
    '',
  ].join('\n');
}
