import { readFile } from 'node:fs/promises';

export async function readPackageVersion(
  packagePath: string | null,
  expectedName: string,
): Promise<string | null> {
  if (!packagePath) return null;
  try {
    const parsed = JSON.parse(await readFile(packagePath, 'utf8')) as Record<string, unknown>;
    return parsed.name === expectedName && validVersion(parsed.version) ? parsed.version : null;
  } catch {
    return null;
  }
}

function validVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return value.length > 0 && value.length <= 128;
}
