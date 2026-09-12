import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { WebtoolsArtifactError, type WebtoolsArtifactFailureKind } from './wasm-artifact-error.js';
import { parseWebtoolsArtifactManifest } from './wasm-artifact-manifest.js';

export async function readVerifiedWebtoolsArtifact(
  artifactUrl: URL,
  manifestUrl: URL,
): Promise<Uint8Array> {
  const manifest = parseWebtoolsArtifactManifest(await readManifest(manifestUrl));
  const bytes = await readArtifact(artifactUrl);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== manifest.artifact.bytes || actualHash !== manifest.artifact.sha256) {
    throw new WebtoolsArtifactError(
      'artifact_corrupt',
      'bundled webtools wasm does not match its build manifest',
    );
  }
  return bytes;
}

async function readManifest(url: URL): Promise<string> {
  try {
    return await readFile(url, 'utf8');
  } catch (cause) {
    throw fileError('manifest', cause);
  }
}

async function readArtifact(url: URL): Promise<Uint8Array> {
  try {
    return await readFile(url);
  } catch (cause) {
    throw fileError('artifact', cause);
  }
}

function fileError(kind: 'manifest' | 'artifact', cause: unknown): WebtoolsArtifactError {
  const state = isMissing(cause) ? 'missing' : 'corrupt';
  const failure = `${kind}_${state}` as WebtoolsArtifactFailureKind;
  const description = state === 'missing' ? 'missing' : 'unreadable';
  return new WebtoolsArtifactError(
    failure,
    `bundled webtools wasm ${kind} is ${description}`,
    cause,
  );
}

function isMissing(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value && value.code === 'ENOENT';
}
