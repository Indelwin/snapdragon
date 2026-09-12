import { WebtoolsArtifactError } from './wasm-artifact-error.js';

export interface WebtoolsArtifactManifest {
  artifact: { bytes: number; sha256: string };
}

export function parseWebtoolsArtifactManifest(text: string): WebtoolsArtifactManifest {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (cause) {
    throw corruptManifest(cause);
  }
  if (!isManifest(value)) throw corruptManifest(new Error('invalid manifest schema'));
  return value;
}

function corruptManifest(cause: unknown): WebtoolsArtifactError {
  return new WebtoolsArtifactError(
    'manifest_corrupt',
    'bundled webtools wasm manifest is corrupt',
    cause,
  );
}

function isManifest(value: unknown): value is WebtoolsArtifactManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.artifact)) return false;
  const { bytes, sha256 } = value.artifact;
  return (
    Number.isSafeInteger(bytes) &&
    (bytes as number) >= 0 &&
    typeof sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(sha256)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
