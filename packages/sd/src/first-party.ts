import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function ensureFirstPartySkills(root: string): void {
  copyChildren(firstPartyPath('skills'), root);
}

export function ensureFirstPartyProfile(root: string, name: string): boolean {
  const source = join(firstPartyPath('profiles'), name);
  if (!existsSync(source)) return false;
  copyDirectoryMissing(source, join(root, name));
  return true;
}

export function ensureFirstPartyProfiles(root: string): void {
  copyChildren(firstPartyPath('profiles'), root);
}

function firstPartyPath(...parts: string[]): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'first-party', ...parts);
}

function copyChildren(source: string, target: string): void {
  if (!existsSync(source)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    copyDirectoryMissing(join(source, entry.name), join(target, entry.name));
  }
}

function copyDirectoryMissing(source: string, target: string): void {
  if (!existsSync(source)) return;
  if (existsSync(target)) return;
  copyDirectory(source, target);
}

function copyDirectory(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const from = join(source, entry.name);
    const to = join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) copyFile(from, to);
  }
}

function copyFile(source: string, target: string): void {
  mkdirSync(dirname(target), { recursive: true });
  const mode = statSync(source).mode;
  writeFileSync(target, readFileSync(source));
  try {
    chmodSync(target, mode);
  } catch {
    // The content matters; preserving mode is best-effort for package assets.
  }
}
