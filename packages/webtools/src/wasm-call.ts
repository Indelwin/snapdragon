import {
  asWasmResponseError,
  asWasmRuntimeError,
  type WebtoolsExports,
  type WebtoolsOp,
  webtoolsExportFor,
} from './wasm-types.js';
import {
  assertWasmAllocation,
  assertWasmResponseRange,
  assertWebtoolsResponse,
  encodeWasmRequest,
  isWasmMemoryRange,
} from './wasm-validate.js';

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

export const MAX_ABI_REQUEST_BYTES = 8 * 1024 * 1024;
export const MAX_ABI_RESPONSE_BYTES = 16 * 1024 * 1024;

export function callWasmExport(
  exports: WebtoolsExports,
  op: WebtoolsOp,
  request: unknown,
): unknown {
  const bytes = encodeWasmRequest(request, MAX_ABI_REQUEST_BYTES);
  const packed = invokeExport(exports, webtoolsExportFor(exports, op), bytes);
  return parseResponse(exports, packed);
}

function invokeExport(
  exports: WebtoolsExports,
  fn: (ptr: number, len: number) => bigint,
  bytes: Uint8Array,
): bigint {
  let inPtr: number | undefined;
  let failure: unknown;
  let failureKind: 'allocation' | 'trap' = 'allocation';
  let packed = 0n;
  try {
    inPtr = allocRequest(exports, bytes.byteLength);
    failureKind = 'trap';
    new Uint8Array(exports.memory.buffer, inPtr, bytes.byteLength).set(bytes);
    packed = fn(inPtr, bytes.byteLength);
  } catch (error) {
    failure = asWasmRuntimeError(error, failureKind);
  } finally {
    if (inPtr !== undefined) {
      try {
        exports.wt_dealloc(inPtr, bytes.byteLength);
      } catch (error) {
        if (failure === undefined) failure = asWasmRuntimeError(error, 'trap');
      }
    }
  }
  if (failure !== undefined) throw failure;
  return packed;
}

function allocRequest(exports: WebtoolsExports, size: number): number {
  const ptr = exports.wt_alloc(size) >>> 0;
  assertWasmAllocation(ptr);
  return ptr;
}

function parseResponse(exports: WebtoolsExports, packed: bigint): unknown {
  let output: { ptr: number; len: number } | undefined;
  let outputCanBeFreed = false;
  let failure: unknown;
  let parsed: unknown;
  try {
    output = unpackResult(packed);
    outputCanBeFreed = isWasmMemoryRange(exports.memory, output.ptr, output.len);
    assertWasmResponseRange(exports.memory, output.ptr, output.len, MAX_ABI_RESPONSE_BYTES);
    const view = new Uint8Array(exports.memory.buffer, output.ptr, output.len);
    parsed = assertWebtoolsResponse(JSON.parse(TEXT_DECODER.decode(view.slice())) as unknown);
  } catch (error) {
    failure = asWasmResponseError(error);
  } finally {
    if (output !== undefined && outputCanBeFreed) {
      try {
        exports.wt_dealloc(output.ptr, output.len);
      } catch (error) {
        if (failure === undefined) failure = asWasmRuntimeError(error, 'trap');
      }
    }
  }
  if (failure !== undefined) throw failure;
  return parsed;
}

function unpackResult(packed: bigint): { ptr: number; len: number } {
  return {
    ptr: Number(packed >> 32n) >>> 0,
    len: Number(packed & 0xffff_ffffn) >>> 0,
  };
}
