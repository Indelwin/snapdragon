import { readdir, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import {
  type DoctorPackage,
  readDoctorPackage,
  readDoctorPackageManifest,
} from './doctor-package-manifest.js';

export interface WorkspacePackageIndex {
  byName: ReadonlyMap<string, DoctorPackage>;
  byRoot: ReadonlyMap<string, DoctorPackage>;
}

export async function discoverWorkspacePackages(root: string): Promise<DoctorPackage[] | null> {
  const manifest = await readDoctorPackageManifest(root);
  if (!manifest?.workspaces) return null;
  const roots = (
    await Promise.all(manifest.workspaces.map((pattern) => expandWorkspacePattern(root, pattern)))
  ).flat();
  const packages = await Promise.all(roots.map((packageRoot) => readDoctorPackage(packageRoot)));
  return packages.filter((value): value is DoctorPackage => value !== null);
}

export function indexWorkspacePackages(packages: readonly DoctorPackage[]): WorkspacePackageIndex {
  return {
    byName: new Map(packages.map((value) => [value.name, value])),
    byRoot: new Map(packages.map((value) => [resolve(value.root), value])),
  };
}

export function resolveWorkspaceDependency(
  packages: WorkspacePackageIndex,
  packageRoot: string,
  dependencyName: string,
  specifier: string,
): DoctorPackage | undefined {
  const named = packages.byName.get(dependencyName);
  if (named) return named;
  if (!specifier.startsWith('file:')) return undefined;
  return packages.byRoot.get(resolve(packageRoot, specifier.slice('file:'.length)));
}

export function relativeWorkspacePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function expandWorkspacePattern(root: string, pattern: string): Promise<string[]> {
  const segments = pattern.split('/').filter(Boolean);
  let directories = [resolve(root)];
  for (const segment of segments) {
    const next: string[] = [];
    for (const directory of directories) {
      if (segment === '*') {
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        next.push(
          ...entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => resolve(directory, entry.name)),
        );
      } else if (!segment.includes('*')) {
        const candidate = resolve(directory, segment);
        if (await exists(candidate)) next.push(candidate);
      }
    }
    directories = next;
  }
  return directories.filter((directory) => insideRoot(root, directory));
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

function insideRoot(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..');
}
