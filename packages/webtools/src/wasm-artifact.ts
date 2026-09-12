import { WebtoolsArtifactError } from './wasm-artifact-error.js';
import { readVerifiedWebtoolsArtifact } from './wasm-artifact-reader.js';

export type { WebtoolsArtifactFailureKind } from './wasm-artifact-error.js';
export { WebtoolsArtifactError } from './wasm-artifact-error.js';

export const webtoolsArtifactUrl = new URL('../dist/snapdragon_webtools.wasm', import.meta.url);
export const webtoolsManifestUrl = new URL(
  '../dist/snapdragon_webtools.manifest.json',
  import.meta.url,
);

export async function compileVerifiedWebtoolsArtifact(
  artifactUrl = webtoolsArtifactUrl,
  manifestUrl = webtoolsManifestUrl,
): Promise<WebAssembly.Module> {
  const bytes = await readVerifiedWebtoolsArtifact(artifactUrl, manifestUrl);
  try {
    const ownedBytes = new Uint8Array(bytes.byteLength);
    ownedBytes.set(bytes);
    return await WebAssembly.compile(ownedBytes);
  } catch (cause) {
    throw new WebtoolsArtifactError(
      'artifact_corrupt',
      'bundled webtools wasm is not a valid module',
      cause,
    );
  }
}
