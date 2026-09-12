import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, parse, resolve } from 'node:path';

export async function resolveDoctorPackageRoot(
  sdPackageRoot: string,
  specifier: string,
  expectedName: string,
  override: string | undefined,
  workspaceSibling: string,
): Promise<string | null> {
  if (override) return realPackageRoot(override);
  const entrypoint = resolveDependencyEntrypoint(sdPackageRoot, specifier);
  const installed = entrypoint ? await matchingPackageRoot(entrypoint, expectedName) : null;
  if (installed) return installed;
  return matchingPackageRoot(join(sdPackageRoot, '..', workspaceSibling), expectedName);
}

function resolveDependencyEntrypoint(sdPackageRoot: string, specifier: string): string | null {
  try {
    return createRequire(join(sdPackageRoot, 'package.json')).resolve(specifier);
  } catch {
    return null;
  }
}

async function matchingPackageRoot(start: string, expectedName: string): Promise<string | null> {
  let directory = await searchDirectory(start);
  for (;;) {
    if (await packageHasName(join(directory, 'package.json'), expectedName)) {
      return realPackageRoot(directory);
    }
    const parent = dirname(directory);
    if ([directory, parse(directory).root].includes(parent)) return null;
    directory = parent;
  }
}

async function searchDirectory(start: string): Promise<string> {
  const absolute = resolve(start);
  try {
    return (await stat(absolute)).isDirectory() ? absolute : dirname(absolute);
  } catch {
    return dirname(absolute);
  }
}

async function packageHasName(path: string, expectedName: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    return parsed.name === expectedName;
  } catch {
    return false;
  }
}

async function realPackageRoot(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(path).catch(() => resolve(path));
}
