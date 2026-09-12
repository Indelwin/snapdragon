export const SD_BUILD_INFO_SCHEMA_VERSION = 1 as const;

export interface SdBuildInfo {
  schemaVersion: typeof SD_BUILD_INFO_SCHEMA_VERSION;
  sourceHash: string;
  commit: string;
  artifactHashes: {
    runtime: string;
    sd: string;
    core: string;
    webtools: string;
    renderer: string;
    coreWasm: string;
    webtoolsWasm: string;
  };
  builtAt: string;
  packageVersions: {
    sd: string;
    core: string;
    webtools: string;
    renderer: string;
  };
}

export type SdBuildInfoReadResult =
  | { status: 'ok'; info: SdBuildInfo }
  | { status: 'missing'; info: null }
  | { status: 'invalid'; info: null };
