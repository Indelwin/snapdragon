import { stat } from 'node:fs/promises';
import { readSdBuildInfo, type SdBuildInfo } from './build-info.js';
import {
  fingerprintPaths,
  hashFile,
  SD_COMPILED_FINGERPRINT_PATHS,
  SD_FINGERPRINT_EXCLUDES,
  SD_RENDERER_FINGERPRINT_PATHS,
} from './doctor-build.js';
import { readPackageVersion, resolveDoctorPaths, SD_DOCTOR_PACKAGE_NAMES } from './doctor-paths.js';
import { fingerprintSdRuntimeArtifacts } from './doctor-runtime-fingerprint.js';
import { fingerprintSdSource } from './doctor-source-fingerprint.js';
import {
  SD_DOCTOR_SCHEMA_VERSION,
  type SdDoctorArtifact,
  type SdDoctorFingerprint,
  type SdDoctorPathOverrides,
  type SdDoctorRendererMode,
  type SdDoctorReport,
} from './doctor-types.js';
import { collectDoctorWarnings } from './doctor-warnings.js';

export interface SdDoctorOptions extends SdDoctorPathOverrides {
  nodeVersion?: string;
  rendererMode?: SdDoctorRendererMode;
}

export async function collectSdDoctorReport(
  options: SdDoctorOptions = {},
): Promise<SdDoctorReport> {
  const paths = await resolveDoctorPaths(options);
  const buildResult = await readSdBuildInfo(paths.buildInfo);
  const build = buildResult.info;
  const versions = await collectVersions(
    paths,
    options.nodeVersion ?? process.versions.node,
    options.rendererMode ?? effectiveRendererMode(process.env.NODE_ENV),
  );
  const [source, compiled, wasm] = await Promise.all([
    sourceFingerprint(paths.sourceRoot, build),
    compiledFingerprints(paths, build),
    wasmArtifacts(paths, build),
  ]);
  return {
    schemaVersion: SD_DOCTOR_SCHEMA_VERSION,
    paths: reportPaths(paths),
    versions,
    build: {
      manifestStatus: buildResult.status,
      sourceHash: build?.sourceHash ?? null,
      commit: build?.commit ?? null,
      builtAt: build?.builtAt ?? null,
    },
    source,
    compiled,
    wasm,
    warnings: collectDoctorWarnings(buildResult.status, versions, build, source, compiled, wasm),
  };
}

export type {
  SdDoctorArtifact,
  SdDoctorFingerprint,
  SdDoctorReport,
  SdDoctorWarning,
} from './doctor-types.js';

async function collectVersions(
  paths: Awaited<ReturnType<typeof resolveDoctorPaths>>,
  node: string,
  rendererMode: SdDoctorRendererMode,
): Promise<SdDoctorReport['versions']> {
  const [sd, core, webtools, renderer] = await Promise.all([
    readPackageVersion(paths.sdPackage, SD_DOCTOR_PACKAGE_NAMES.sd),
    readPackageVersion(paths.corePackage, SD_DOCTOR_PACKAGE_NAMES.core),
    readPackageVersion(paths.webtoolsPackage, SD_DOCTOR_PACKAGE_NAMES.webtools),
    readPackageVersion(paths.rendererPackage, SD_DOCTOR_PACKAGE_NAMES.renderer),
  ]);
  return { node, renderer, rendererMode, sd, core, webtools };
}

function effectiveRendererMode(nodeEnv: string | undefined): SdDoctorRendererMode {
  return nodeEnv === 'production' ? 'production' : 'development';
}

async function sourceFingerprint(
  root: string | null,
  build: SdBuildInfo | null,
): Promise<SdDoctorFingerprint> {
  const actual = root ? await fingerprintSdSource(root) : null;
  return fingerprint(root, actual, build?.sourceHash ?? null);
}

async function compiledFingerprints(
  paths: Awaited<ReturnType<typeof resolveDoctorPaths>>,
  build: SdBuildInfo | null,
): Promise<SdDoctorReport['compiled']> {
  const [runtime, sd, core, webtools, renderer] = await Promise.all([
    runtimeFingerprint(paths.sdPackageRoot, build?.artifactHashes.runtime ?? null),
    compiledFingerprint(paths.sdPackageRoot, build?.artifactHashes.sd ?? null, true),
    compiledFingerprint(paths.corePackageRoot, build?.artifactHashes.core ?? null),
    compiledFingerprint(paths.webtoolsPackageRoot, build?.artifactHashes.webtools ?? null),
    rendererFingerprint(paths.rendererPackageRoot, build?.artifactHashes.renderer ?? null),
  ]);
  return { runtime, sd, core, webtools, renderer };
}

async function runtimeFingerprint(
  root: string,
  expected: string | null,
): Promise<SdDoctorFingerprint> {
  return fingerprint(root, await fingerprintSdRuntimeArtifacts(root), expected);
}

async function compiledFingerprint(
  root: string | null,
  expected: string | null,
  excludeBuildInfo = false,
): Promise<SdDoctorFingerprint> {
  const actual = root
    ? await fingerprintPaths(root, SD_COMPILED_FINGERPRINT_PATHS, {
        exclude: excludeBuildInfo ? SD_FINGERPRINT_EXCLUDES : [],
      })
    : null;
  return fingerprint(root, actual, expected);
}

async function rendererFingerprint(
  root: string | null,
  expected: string | null,
): Promise<SdDoctorFingerprint> {
  const actual = root ? await fingerprintPaths(root, SD_RENDERER_FINGERPRINT_PATHS) : null;
  return fingerprint(root, actual, expected);
}

async function wasmArtifacts(
  paths: Awaited<ReturnType<typeof resolveDoctorPaths>>,
  build: SdBuildInfo | null,
): Promise<SdDoctorReport['wasm']> {
  const [core, webtools] = await Promise.all([
    inspectArtifact(paths.coreWasm, build?.artifactHashes.coreWasm ?? null),
    inspectArtifact(paths.webtoolsWasm, build?.artifactHashes.webtoolsWasm ?? null),
  ]);
  return { core, webtools };
}

async function inspectArtifact(
  path: string | null,
  expectedSha256: string | null,
): Promise<SdDoctorArtifact> {
  const sha256 = path ? await hashFile(path) : null;
  let sizeBytes: number | null = null;
  if (sha256 && path)
    sizeBytes = await stat(path)
      .then((value) => value.size)
      .catch(() => null);
  return {
    path,
    sizeBytes,
    sha256,
    expectedSha256,
    matchesBuild: compared(sha256, expectedSha256),
  };
}

function fingerprint(
  root: string | null,
  sha256: string | null,
  expectedSha256: string | null,
): SdDoctorFingerprint {
  return { root, sha256, expectedSha256, matchesBuild: compared(sha256, expectedSha256) };
}

function compared(actual: string | null, expected: string | null): boolean | null {
  return actual && expected ? actual === expected : null;
}

function reportPaths(
  paths: Awaited<ReturnType<typeof resolveDoctorPaths>>,
): SdDoctorReport['paths'] {
  return {
    nodeExecutable: paths.nodeExecutable,
    cliEntrypoint: paths.cliEntrypoint,
    sdPackage: paths.sdPackage,
    corePackage: paths.corePackage,
    webtoolsPackage: paths.webtoolsPackage,
    rendererPackage: paths.rendererPackage,
    buildInfo: paths.buildInfo,
    sourceRoot: paths.sourceRoot,
  };
}
