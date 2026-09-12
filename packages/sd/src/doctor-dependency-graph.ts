import type { DoctorPackage } from './doctor-package-manifest.js';

export type DoctorDependencyResolver = (
  packageValue: DoctorPackage,
) => Promise<readonly DoctorPackage[] | null>;

export async function traverseDoctorDependencyGraph(
  entrypoint: DoctorPackage,
  resolveDependencies: DoctorDependencyResolver,
): Promise<DoctorPackage[] | null> {
  const discovered: DoctorPackage[] = [];
  const pending = [entrypoint];
  const visited = new Set<string>();
  const rootsByName = new Map<string, string>();
  while (pending.length > 0) {
    const current = pending.pop() as DoctorPackage;
    const knownRoot = rootsByName.get(current.name);
    if (knownRoot && knownRoot !== current.root) return null;
    if (visited.has(current.root)) continue;
    visited.add(current.root);
    rootsByName.set(current.name, current.root);
    discovered.push(current);
    const dependencies = await resolveDependencies(current);
    if (!dependencies) return null;
    pending.push(...dependencies);
  }
  return discovered;
}
