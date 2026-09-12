import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { SD_FINGERPRINT_EXCLUDES } from './doctor-build.js';
import { traverseDoctorDependencyGraph } from './doctor-dependency-graph.js';
import {
  aggregatePackageFingerprints,
  type PackageFingerprintTarget,
} from './doctor-fingerprint-aggregation.js';
import { type DoctorPackage, readDoctorPackage } from './doctor-package-manifest.js';

const SD_PACKAGE_NAME = '@snapdragon-ai/sd';
const RENDERER_DEPENDENCY_NAME = 'ink';
const RENDERER_PACKAGE_NAME = '@snapdragon-ai/ink';

export async function fingerprintSdRuntimeArtifacts(sdPackageRoot: string): Promise<string | null> {
  const packages = await discoverRuntimePackages(sdPackageRoot);
  if (!packages) return null;
  return aggregatePackageFingerprints(
    'snapdragon-runtime-fingerprint-v1',
    packages.map(runtimeFingerprintTarget),
  );
}

async function discoverRuntimePackages(sdPackageRoot: string): Promise<DoctorPackage[] | null> {
  const entrypoint = await readInstalledPackage(sdPackageRoot);
  if (entrypoint?.name !== SD_PACKAGE_NAME) return null;
  return traverseDoctorDependencyGraph(entrypoint, resolveInstalledDependencies);
}

function runtimeFingerprintTarget(packageValue: DoctorPackage): PackageFingerprintTarget {
  return {
    name: packageValue.name,
    root: packageValue.root,
    paths: packageValue.name === RENDERER_PACKAGE_NAME ? ['dist/build'] : ['dist'],
    exclude: packageValue.name === SD_PACKAGE_NAME ? SD_FINGERPRINT_EXCLUDES : [],
  };
}

async function readInstalledPackage(root: string): Promise<DoctorPackage | null> {
  const canonicalRoot = await realpath(root).catch(() => resolve(root));
  return readDoctorPackage(canonicalRoot);
}

async function resolveInstalledDependencies(
  packageValue: DoctorPackage,
): Promise<readonly DoctorPackage[] | null> {
  const names = packageValue.dependencies.map(([name]) => name).filter(internalDependency);
  const dependencies = await Promise.all(
    names.map(async (name) => {
      const dependency = await resolveInstalledDependency(packageValue.root, name);
      if (!dependency) return null;
      if (!expectedPackageName(name, dependency.name)) return null;
      return dependency;
    }),
  );
  if (dependencies.includes(null)) return null;
  return dependencies as DoctorPackage[];
}

async function resolveInstalledDependency(
  packageRoot: string,
  dependencyName: string,
): Promise<DoctorPackage | null> {
  let directory = packageRoot;
  for (;;) {
    const candidate = await readInstalledPackage(join(directory, 'node_modules', dependencyName));
    if (candidate) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function internalDependency(name: string): boolean {
  return name.startsWith('@snapdragon-ai/') || name === RENDERER_DEPENDENCY_NAME;
}

function expectedPackageName(dependencyName: string, packageName: string): boolean {
  if (dependencyName === RENDERER_DEPENDENCY_NAME) return packageName === RENDERER_PACKAGE_NAME;
  return dependencyName === packageName;
}
