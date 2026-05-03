import type { SdRuntime } from './runtime.js';

export function runtimeWarningLines(runtime: SdRuntime): string[] {
  return runtime.warnings.map((warning) => `warning: ${warning}`);
}

export function withRuntimeWarnings(message: string, runtime: SdRuntime): string {
  const warnings = runtimeWarningLines(runtime);
  return warnings.length === 0 ? message : [message, ...warnings].join('\n');
}
