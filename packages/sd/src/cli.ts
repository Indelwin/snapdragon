#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import { runPreRuntimeCommand } from './cli-commands.js';
import { isRunMode } from './modes.js';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (await runPreRuntimeCommand(args)) return;
  if (!isRunMode(args.mode)) throw new Error(`Unsupported runtime mode: ${args.mode}`);
  const [{ createSdRuntime }, { runSelectedMode }] = await Promise.all([
    import('./runtime.js'),
    import('./run-mode.js'),
  ]);
  const runtime = await createSdRuntime(args);
  await runSelectedMode(args.mode, runtime, args.prompt);
}

export { helpText } from './help.js';

export function isDirectEntrypoint(metaUrl: string, entrypoint = process.argv[1]): boolean {
  try {
    return realpathSync(entrypoint) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (isDirectEntrypoint(import.meta.url)) {
  main().catch((error) => {
    stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
