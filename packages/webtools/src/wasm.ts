import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { webtoolsArtifactUrl } from './wasm-artifact.js';
import { instantiateWebtoolsModule } from './wasm-instantiate.js';
import type { WebtoolsCore } from './wasm-types.js';

export { webtoolsArtifactUrl, webtoolsManifestUrl } from './wasm-artifact.js';
export { MAX_ABI_REQUEST_BYTES, MAX_ABI_RESPONSE_BYTES } from './wasm-call.js';
export type { WebtoolsWasmMemoryStats } from './wasm-diagnostics.js';
export { getWebtoolsWasmMemoryStats } from './wasm-diagnostics.js';
export { instantiateWebtools, instantiateWebtoolsModule } from './wasm-instantiate.js';
export type {
  WebtoolsCore,
  WebtoolsDiagnostics,
  WebtoolsOp,
  WebtoolsWasmFailureKind,
} from './wasm-types.js';
export { WebtoolsWasmRuntimeError } from './wasm-types.js';

let cachedModule: Promise<WebAssembly.Module> | undefined;

export async function loadWebtools(): Promise<WebtoolsCore> {
  if (!cachedModule) {
    const pending = loadBundledModule();
    cachedModule = pending;
    void pending.catch(() => {
      if (cachedModule === pending) cachedModule = undefined;
    });
  }
  return instantiateWebtoolsModule(await cachedModule);
}

async function loadBundledModule(): Promise<WebAssembly.Module> {
  const path = fileURLToPath(webtoolsArtifactUrl);
  const bytes = await readFile(path);
  return WebAssembly.compile(bytes);
}
