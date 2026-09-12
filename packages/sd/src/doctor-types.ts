export const SD_DOCTOR_SCHEMA_VERSION = 1 as const;

export type SdDoctorWarningCode =
  | 'artifact_missing'
  | 'artifact_hash_mismatch'
  | 'build_info_invalid'
  | 'build_info_missing'
  | 'compiled_hash_mismatch'
  | 'package_unresolved'
  | 'package_version_mismatch'
  | 'renderer_development_mode'
  | 'source_hash_mismatch';

export type SdDoctorWarningTarget =
  | 'build-info'
  | 'core'
  | 'executable'
  | 'renderer'
  | 'runtime'
  | 'sd'
  | 'webtools';

export interface SdDoctorWarning {
  code: SdDoctorWarningCode;
  target: SdDoctorWarningTarget;
  message: string;
}

export interface SdDoctorArtifact {
  path: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  expectedSha256: string | null;
  matchesBuild: boolean | null;
}

export interface SdDoctorFingerprint {
  root: string | null;
  sha256: string | null;
  expectedSha256: string | null;
  matchesBuild: boolean | null;
}

export interface SdDoctorReport {
  schemaVersion: typeof SD_DOCTOR_SCHEMA_VERSION;
  paths: {
    nodeExecutable: string;
    cliEntrypoint: string | null;
    sdPackage: string;
    corePackage: string | null;
    webtoolsPackage: string | null;
    rendererPackage: string | null;
    buildInfo: string;
    sourceRoot: string | null;
  };
  versions: {
    node: string;
    renderer: string | null;
    rendererMode: SdDoctorRendererMode;
    sd: string | null;
    core: string | null;
    webtools: string | null;
  };
  build: {
    manifestStatus: 'ok' | 'missing' | 'invalid';
    sourceHash: string | null;
    commit: string | null;
    builtAt: string | null;
  };
  source: SdDoctorFingerprint;
  compiled: {
    runtime: SdDoctorFingerprint;
    sd: SdDoctorFingerprint;
    core: SdDoctorFingerprint;
    webtools: SdDoctorFingerprint;
    renderer: SdDoctorFingerprint;
  };
  wasm: {
    core: SdDoctorArtifact;
    webtools: SdDoctorArtifact;
  };
  warnings: SdDoctorWarning[];
}

export type SdDoctorRendererMode = 'production' | 'development';

export interface SdDoctorPathOverrides {
  nodeExecutable?: string;
  cliEntrypoint?: string | null;
  sdPackageRoot?: string;
  packageRoots?: {
    core?: string;
    webtools?: string;
    renderer?: string;
  };
}
