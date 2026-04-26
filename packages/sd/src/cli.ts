#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSdPlaceholderMessage } from './index.js';

const helpText = `sd

Reserved Snapdragon command. Batteries-included code agent placeholder.

Usage:
  sd
  sd --help
  sd --version
`;

const handlers = new Map<string, () => string | Promise<string>>([
  ['--help', () => helpText],
  ['-h', () => helpText],
  ['--version', readPackageVersion],
  ['-v', readPackageVersion],
]);

async function main(argv = process.argv.slice(2)): Promise<void> {
  const [command = ''] = argv;
  const handler = handlers.get(command) || createSdPlaceholderMessage;
  stdout.write(`${await handler()}\n`);
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
    stderr.write(`${String(error)}\n`);
    process.exitCode = 1;
  });
}
