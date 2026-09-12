import { createHash } from 'node:crypto';
import { fingerprintPaths } from './doctor-build.js';

export interface PackageFingerprintTarget {
  name: string;
  root: string;
  paths: readonly string[];
  exclude?: readonly string[];
}

export async function aggregatePackageFingerprints(
  namespace: string,
  targets: readonly PackageFingerprintTarget[],
): Promise<string | null> {
  const hash = createHash('sha256');
  hash.update(`${namespace}\0`);
  const ordered = [...targets].sort((left, right) => left.name.localeCompare(right.name));
  for (const target of ordered) {
    const packageHash = await fingerprintPaths(target.root, target.paths, {
      exclude: target.exclude,
    });
    if (!packageHash) return null;
    hash.update(target.name);
    hash.update('\0');
    hash.update(packageHash);
    hash.update('\0');
  }
  return hash.digest('hex');
}
