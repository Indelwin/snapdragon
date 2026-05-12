import { callWasmExport } from './wasm-call.js';
import type { WebtoolsCore } from './wasm-types.js';
import { assertWebtoolsExports } from './wasm-validate.js';

export async function instantiateWebtools(bytes: BufferSource): Promise<WebtoolsCore> {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const exports = assertWebtoolsExports(instance.exports);
  return {
    call(op, request) {
      return callWasmExport(exports, op, request) as never;
    },
  };
}
