#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.js';
import {
  DEFAULT_SD_ENV_PATH,
  loadSdConfig,
  writeDefaultConfig,
  writeEnvTemplate,
} from './config.js';
import { helpText } from './help.js';
import { type SdProfileInfo, SdProfileStore } from './profile.js';
import { runSelectedMode } from './run-mode.js';
import { createSdRuntime } from './runtime.js';
import { runtimeSessionStore } from './runtime-session.js';
import { printSessionList } from './session-list-output.js';

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
  if (args.mode === 'list-sessions') {
    await listSessions(args.configPath);
    return;
  }
  if (args.mode === 'delete-session') {
    await deleteSession(args.configPath, args.deleteSessionId);
    return;
  }
  if (args.mode === 'list-profiles') {
    listProfiles(new SdProfileStore({ root: args.profileRoot }));
    return;
  }

  const runtime = await createSdRuntime(args);
  await runSelectedMode(args.mode, runtime, args.prompt);
}

async function listSessions(configPath: string): Promise<void> {
  await printSessionList(configPath, stdout);
}

async function deleteSession(configPath: string, sessionId: string | undefined): Promise<void> {
  if (!sessionId) throw new Error('--delete-session requires an id');
  const config = await loadSdConfig(configPath);
  const deleted = runtimeSessionStore(config).delete(sessionId);
  stdout.write(deleted ? `Deleted session ${sessionId}\n` : `Session not found: ${sessionId}\n`);
}

function listProfiles(store: SdProfileStore): void {
  const profiles = store.list();
  if (profiles.length === 0) {
    stdout.write('No profiles found.\n');
    return;
  }
  stdout.write(profiles.map(profileLine).join('\n').concat('\n'));
}

function profileLine(profile: SdProfileInfo): string {
  if (!profile.valid) return `! ${profile.name}\t${profile.error}`;
  const active = profile.active ? '*' : ' ';
  const description = profile.config?.description ? `\t${profile.config.description}` : '';
  return `${active} ${profile.name}${description}`;
}

export { helpText } from './help.js';

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
