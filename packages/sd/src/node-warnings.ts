type EmitWarning = typeof process.emitWarning;

const SQLITE_EXPERIMENTAL_WARNING =
  'SQLite is an experimental feature and might change at any time';

/**
 * Node 22 emits an ExperimentalWarning each time a short-lived Snapdragon CLI
 * command imports node:sqlite. The session index intentionally uses that module,
 * so hide only this known warning while preserving all other process warnings.
 */
export function suppressKnownNodeWarnings(): void {
  const originalEmitWarning = process.emitWarning.bind(process) as EmitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === 'string' ? args[0] : undefined;
    if (type === 'ExperimentalWarning' && sqliteWarningMessage(warning)) return;
    return originalEmitWarning(
      warning as string & Error,
      ...(args as Parameters<EmitWarning> extends [any, ...infer R] ? R : never),
    );
  }) as EmitWarning;
}

function sqliteWarningMessage(warning: string | Error): boolean {
  const message = typeof warning === 'string' ? warning : warning.message;
  return message === SQLITE_EXPERIMENTAL_WARNING;
}
