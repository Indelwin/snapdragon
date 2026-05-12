import type { WebtoolsExports } from './wasm-types.js';

const REQUIRED_EXPORTS = [
  'wt_alloc',
  'wt_dealloc',
  'wt_url_util',
  'wt_robots',
  'wt_content_filter',
  'wt_extractor',
] as const;

export function assertWebtoolsExports(exports: WebAssembly.Exports): WebtoolsExports {
  const candidate = exports as unknown as Partial<WebtoolsExports>;
  if (!(candidate.memory instanceof WebAssembly.Memory)) throw missingExports();
  for (const name of REQUIRED_EXPORTS) {
    if (typeof candidate[name] !== 'function') throw missingExports();
  }
  return candidate as WebtoolsExports;
}

function missingExports(): Error {
  return new Error('webtools wasm module is missing required exports');
}
