import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { webtoolsArtifactUrl } from './wasm-artifact.js';
import { instantiateWebtools } from './wasm-instantiate.js';
import type { WebtoolsCore } from './wasm-types.js';

export { webtoolsArtifactUrl } from './wasm-artifact.js';
export { instantiateWebtools } from './wasm-instantiate.js';
export type { WebtoolsCore, WebtoolsOp } from './wasm-types.js';

let cached: Promise<WebtoolsCore> | undefined;

export function loadWebtools(): Promise<WebtoolsCore> {
  if (!cached) cached = loadBundledWebtools();
  return cached;
}

async function loadBundledWebtools(): Promise<WebtoolsCore> {
  const path = fileURLToPath(webtoolsArtifactUrl);
  const bytes = await readFile(path);
  return instantiateWebtools(bytes);
}
