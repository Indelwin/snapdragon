import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fingerprintPaths } from './doctor-build.js';
import { traverseDoctorDependencyGraph } from './doctor-dependency-graph.js';
import type { DoctorPackage } from './doctor-package-manifest.js';
import {
  discoverWorkspacePackages,
  indexWorkspacePackages,
  relativeWorkspacePath,
  resolveWorkspaceDependency,
  type WorkspacePackageIndex,
} from './doctor-workspace-packages.js';

const SD_PACKAGE_NAME = '@snapdragon-ai/sd';
const ROOT_SOURCE_PATHS = [
  'Cargo.lock',
  'Cargo.toml',
  'package-lock.json',
  'package.json',
  'tsconfig.base.json',
  'scripts/build-info.mjs',
  'scripts/build-wasm.sh',
  'scripts/build-webtools-wasm.sh',
  'crates/core/Cargo.toml',
  'crates/core/src',
  'crates/webtools/Cargo.toml',
  'crates/webtools/src',
] as const;
const PACKAGE_SOURCE_CANDIDATES = ['src', 'scripts', 'vendor', 'tsconfig.build.json'] as const;

export async function fingerprintSdSource(root: string): Promise<string | null> {
  const paths = await discoverSdSourceFingerprintPaths(root);
  return paths ? fingerprintPaths(root, paths) : null;
}

export async function discoverSdSourceFingerprintPaths(
  root: string,
): Promise<readonly string[] | null> {
  const packages = await discoverRuntimeWorkspacePackages(root);
  if (!packages) return null;
  const paths: string[] = [...ROOT_SOURCE_PATHS];
  for (const packageValue of packages) {
    const packagePath = relativeWorkspacePath(root, packageValue.root);
    paths.push(`${packagePath}/package.json`);
    for (const candidate of PACKAGE_SOURCE_CANDIDATES) {
      if (await exists(resolve(packageValue.root, candidate))) {
        paths.push(`${packagePath}/${candidate}`);
      }
    }
  }
  return [...new Set(paths)].sort();
}

async function discoverRuntimeWorkspacePackages(root: string): Promise<DoctorPackage[] | null> {
  const packages = await discoverWorkspacePackages(root);
  if (!packages) return null;
  const index = indexWorkspacePackages(packages);
  const entrypoint = index.byName.get(SD_PACKAGE_NAME);
  if (!entrypoint) return null;
  return traverseDoctorDependencyGraph(entrypoint, async (packageValue) =>
    workspaceDependencies(packageValue, index),
  );
}

function workspaceDependencies(
  packageValue: DoctorPackage,
  packages: WorkspacePackageIndex,
): DoctorPackage[] {
  return packageValue.dependencies.flatMap(([name, specifier]) => {
    const dependency = resolveWorkspaceDependency(packages, packageValue.root, name, specifier);
    return dependency ? [dependency] : [];
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}
