import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDoctorPackageRoots } from './doctor-package-paths.js';
import type { SdDoctorPathOverrides } from './doctor-types.js';

export interface ResolvedDoctorPaths {
  nodeExecutable: string;
  cliEntrypoint: string | null;
  sdPackageRoot: string;
  sdPackage: string;
  corePackageRoot: string | null;
  corePackage: string | null;
  webtoolsPackageRoot: string | null;
  webtoolsPackage: string | null;
  rendererPackageRoot: string | null;
  rendererPackage: string | null;
  buildInfo: string;
  coreWasm: string | null;
  webtoolsWasm: string | null;
  sourceRoot: string | null;
}

export async function resolveDoctorPaths(
  overrides: SdDoctorPathOverrides = {},
): Promise<ResolvedDoctorPaths> {
  const sdPackageRoot = await resolvedPath(overrides.sdPackageRoot ?? defaultSdPackageRoot());
  const roots = await resolveDoctorPackageRoots(sdPackageRoot, overrides);
  const sourceRoot = await sourceRootFor(sdPackageRoot);
  return {
    nodeExecutable: await resolvedPath(overrides.nodeExecutable ?? process.execPath),
    cliEntrypoint: await optionalResolvedPath(overrides.cliEntrypoint ?? process.argv[1]),
    sdPackageRoot,
    sdPackage: join(sdPackageRoot, 'package.json'),
    corePackageRoot: roots.core,
    corePackage: packagePath(roots.core),
    webtoolsPackageRoot: roots.webtools,
    webtoolsPackage: packagePath(roots.webtools),
    rendererPackageRoot: roots.renderer,
    rendererPackage: packagePath(roots.renderer),
    buildInfo: join(sdPackageRoot, 'dist', 'build-info.json'),
    sourceRoot,
    coreWasm: roots.core ? join(roots.core, 'dist', 'snapdragon_core.wasm') : null,
    webtoolsWasm: roots.webtools ? join(roots.webtools, 'dist', 'snapdragon_webtools.wasm') : null,
  };
}

function packagePath(root: string | null): string | null {
  return root ? join(root, 'package.json') : null;
}

function defaultSdPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

async function sourceRootFor(sdPackageRoot: string): Promise<string | null> {
  const candidate = resolve(sdPackageRoot, '../..');
  try {
    const parsed = JSON.parse(await readFile(join(candidate, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    return parsed.name === 'snapdragon-monorepo' ? resolvedPath(candidate) : null;
  } catch {
    return null;
  }
}

async function resolvedPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

async function optionalResolvedPath(path: string | null | undefined): Promise<string | null> {
  return path ? resolvedPath(path) : null;
}

export { SD_DOCTOR_PACKAGE_NAMES } from './doctor-package-paths.js';
export { readPackageVersion } from './doctor-package-version.js';
