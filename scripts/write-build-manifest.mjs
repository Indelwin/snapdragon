#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const options = parseArgs(process.argv.slice(2));
const sourceFiles = options.sources.flatMap(walk).sort();
const sourceEntries = sourceFiles.map((path) => ({
  path: portablePath(relative(options.root, path)),
  sha256: hash(readFileSync(path)),
}));
const toolchain = {
  cargo: commandOutput('cargo', ['--version']),
  rustc: commandOutput('rustc', ['-vV']),
  target: options.target,
};
const artifact = readFileSync(options.artifact);
const manifest = {
  schemaVersion: 1,
  source: {
    files: sourceEntries,
    sha256: hash(
      Buffer.from(sourceEntries.map((entry) => `${entry.path}\0${entry.sha256}\n`).join('')),
    ),
  },
  toolchain: {
    ...toolchain,
    sha256: hash(Buffer.from(JSON.stringify(toolchain))),
  },
  artifact: {
    file: portablePath(relative(options.root, options.artifact)),
    bytes: artifact.byteLength,
    sha256: hash(artifact),
  },
};

writeFileSync(options.output, `${JSON.stringify(manifest, null, 2)}\n`);

function parseArgs(args) {
  const values = new Map();
  const sources = [];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith('--') || value === undefined) usage();
    if (key === '--source') sources.push(resolve(value));
    else values.set(key, value);
  }
  const root = values.get('--root');
  const artifact = values.get('--artifact');
  const output = values.get('--output');
  const target = values.get('--target');
  if (!root || !artifact || !output || !target || sources.length === 0) usage();
  return {
    root: resolve(root),
    artifact: resolve(artifact),
    output: resolve(output),
    target,
    sources,
  };
}

function walk(path) {
  const stat = statSync(path);
  if (stat.isFile()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? [child] : [];
  });
}

function commandOutput(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function hash(content) {
  return createHash('sha256').update(content).digest('hex');
}

function portablePath(path) {
  return path.replaceAll('\\', '/');
}

function usage() {
  throw new Error(
    'usage: write-build-manifest.mjs --root DIR --artifact FILE --output FILE --target TARGET --source PATH...',
  );
}
