import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fingerprintFiles, relativeFingerprintPath } from './doctor-fingerprint-files.js';

export const SD_COMPILED_FINGERPRINT_PATHS = ['dist'] as const;
export const SD_RENDERER_FINGERPRINT_PATHS = ['package.json', 'dist/build'] as const;
export const SD_FINGERPRINT_EXCLUDES = ['dist/build-info.json'] as const;

export interface FingerprintOptions {
  exclude?: readonly string[];
}

export async function fingerprintPaths(
  root: string,
  paths: readonly string[],
  options: FingerprintOptions = {},
): Promise<string | null> {
  const files = await fingerprintFiles(root, paths, new Set(options.exclude ?? []));
  if (!files) return null;
  const hash = createHash('sha256');
  hash.update('snapdragon-fingerprint-v1\0');
  for (const file of files) {
    const path = relativeFingerprintPath(root, file);
    hash.update(path);
    hash.update('\0');
    hash.update(await readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function hashFile(path: string): Promise<string | null> {
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) return null;
    return createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  } catch {
    return null;
  }
}

export async function readNamedPackageVersion(
  packageRoot: string,
  expectedName: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(resolve(packageRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    return parsed.name === expectedName && validVersion(parsed.version) ? parsed.version : null;
  } catch {
    return null;
  }
}

function validVersion(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
