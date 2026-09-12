import { SD_BUILD_INFO_SCHEMA_VERSION, type SdBuildInfo } from './build-info-types.js';

export function parseSdBuildInfo(value: unknown): SdBuildInfo | undefined {
  const root = objectValue(value);
  const artifacts = objectValue(root?.artifactHashes);
  const packages = objectValue(root?.packageVersions);
  const fields = normalizedFields(root, artifacts, packages);
  if (Object.values(fields).includes(null)) return undefined;
  return {
    schemaVersion: SD_BUILD_INFO_SCHEMA_VERSION,
    sourceHash: required(fields.sourceHash),
    commit: required(fields.commit),
    artifactHashes: {
      runtime: required(fields.runtime),
      sd: required(fields.sd),
      core: required(fields.core),
      webtools: required(fields.webtools),
      renderer: required(fields.renderer),
      coreWasm: required(fields.coreWasm),
      webtoolsWasm: required(fields.webtoolsWasm),
    },
    builtAt: required(fields.builtAt),
    packageVersions: {
      sd: required(fields.sdVersion),
      core: required(fields.coreVersion),
      webtools: required(fields.webtoolsVersion),
      renderer: required(fields.rendererVersion),
    },
  };
}

function normalizedFields(
  root: Record<string, unknown> | undefined,
  artifacts: Record<string, unknown> | undefined,
  packages: Record<string, unknown> | undefined,
) {
  return {
    schemaVersion:
      root?.schemaVersion === SD_BUILD_INFO_SCHEMA_VERSION ? String(root.schemaVersion) : null,
    sourceHash: sha256(root?.sourceHash),
    commit: limitedString(root?.commit, 256),
    builtAt: timestamp(root?.builtAt),
    runtime: sha256(artifacts?.runtime),
    sd: sha256(artifacts?.sd),
    core: sha256(artifacts?.core),
    webtools: sha256(artifacts?.webtools),
    renderer: sha256(artifacts?.renderer),
    coreWasm: sha256(artifacts?.coreWasm),
    webtoolsWasm: sha256(artifacts?.webtoolsWasm),
    sdVersion: limitedString(packages?.sd, 128),
    coreVersion: limitedString(packages?.core, 128),
    webtoolsVersion: limitedString(packages?.webtools, 128),
    rendererVersion: limitedString(packages?.renderer, 128),
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  if (value === null) return undefined;
  if (typeof value !== 'object') return undefined;
  if (Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function limitedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  return value.length > 0 && value.length <= maxLength ? value : null;
}

function sha256(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[a-f0-9]{64}$/i.test(value) ? value : null;
}

function timestamp(value: unknown): string | null {
  const text = limitedString(value, 256);
  if (!text) return null;
  return Number.isFinite(Date.parse(text)) ? text : null;
}

function required(value: string | null): string {
  return value ?? '';
}
