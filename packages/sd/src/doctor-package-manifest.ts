import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface DoctorPackageManifest {
  name: string | null;
  workspaces: readonly string[] | null;
  dependencies: readonly (readonly [string, string])[];
}

export interface DoctorPackage {
  name: string;
  root: string;
  dependencies: readonly (readonly [string, string])[];
}

export async function readDoctorPackageManifest(
  packageRoot: string,
): Promise<DoctorPackageManifest | null> {
  try {
    const value = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as unknown;
    if (!isRecord(value)) return null;
    return {
      name: typeof value.name === 'string' ? value.name : null,
      workspaces: workspacePatterns(value.workspaces),
      dependencies: [
        ...stringEntries(value.dependencies),
        ...stringEntries(value.optionalDependencies),
      ],
    };
  } catch {
    return null;
  }
}

export async function readDoctorPackage(packageRoot: string): Promise<DoctorPackage | null> {
  const manifest = await readDoctorPackageManifest(packageRoot);
  if (!manifest) return null;
  if (manifest.name === null) return null;
  return { name: manifest.name, root: packageRoot, dependencies: manifest.dependencies };
}

function workspacePatterns(value: unknown): readonly string[] | null {
  const direct = stringArray(value);
  if (direct) return direct;
  if (!isRecord(value)) return null;
  return stringArray(value.packages);
}

function stringEntries(value: unknown): Array<[string, string]> {
  if (!isRecord(value)) return [];
  return Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
}

function stringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === 'string') ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value) return false;
  return typeof value === 'object' && !Array.isArray(value);
}
