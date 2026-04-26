#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import {
  DEFAULT_SD_CONFIG_PATH,
  DEFAULT_SD_ENV_PATH,
  writeDefaultConfig,
  writeEnvTemplate,
} from './config.js';
import { runInteractive, runOneShot } from './repl.js';
import { createSdRuntime } from './runtime.js';

export const helpText = `sd

Batteries-included Snapdragon code agent REPL.

Usage:
  sd [options]
  sd [options] "prompt"

Options:
  --provider <name>    Provider override (anthropic|openai|openai-compatible|mock)
  --model <id>         Model override
  --cwd <path>         Workspace root for coding tools
  --config <path>      Config file path
  --session <id>       Resume or create a named session
  --new-session        Force a new session
  --no-session         Disable session persistence
  --setup              Create default config and env template if missing
  -v, --version        Print version
  -h, --help           Print help

Defaults:
  config: ${DEFAULT_SD_CONFIG_PATH}
  env:    ${DEFAULT_SD_ENV_PATH}
`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.mode === 'help') {
    stdout.write(helpText);
    return;
  }
  if (args.mode === 'version') {
    stdout.write(`${await readPackageVersion()}\n`);
    return;
  }
  if (args.mode === 'setup') {
    await setup(args.configPath);
    return;
  }

  const runtime = await createSdRuntime(args);
  if (args.prompt) {
    await runOneShot(runtime, args.prompt);
  } else {
    await runInteractive(runtime);
  }
}

async function setup(configPath: string): Promise<void> {
  const wroteConfig = await writeDefaultConfig(configPath);
  const wroteEnv = await writeEnvTemplate();
  stdout.write(
    [
      wroteConfig ? `Created ${configPath}` : `Config already exists: ${configPath}`,
      wroteEnv
        ? `Created ${DEFAULT_SD_ENV_PATH}`
        : `Env file already exists: ${DEFAULT_SD_ENV_PATH}`,
      '',
    ].join('\n'),
  );
}

async function readPackageVersion(): Promise<string> {
  const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), '../package.json');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const version = packageJson.version;
  if (typeof version === 'string') return version;
  return 'unknown';
}

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
