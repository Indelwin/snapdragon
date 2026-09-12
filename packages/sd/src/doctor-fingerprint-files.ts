import { readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

export async function fingerprintFiles(
  root: string,
  paths: readonly string[],
  excluded: ReadonlySet<string>,
): Promise<string[] | null> {
  const files: string[] = [];
  for (const path of paths) {
    const absolute = resolve(root, path);
    if (!(await collectFiles(root, absolute, excluded, files))) return null;
  }
  return [...new Set(files)].sort((left, right) =>
    relativeFingerprintPath(root, left).localeCompare(relativeFingerprintPath(root, right)),
  );
}

export function relativeFingerprintPath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function collectFiles(
  root: string,
  path: string,
  excluded: ReadonlySet<string>,
  files: string[],
): Promise<boolean> {
  if (excluded.has(relativeFingerprintPath(root, path))) return true;
  const metadata = await stat(path).catch(() => null);
  if (!metadata) return false;
  if (metadata.isFile()) {
    files.push(path);
    return true;
  }
  if (!metadata.isDirectory()) return false;
  const entries = await readdir(path);
  for (const entry of entries.sort()) {
    if (!(await collectFiles(root, resolve(path, entry), excluded, files))) return false;
  }
  return true;
}
