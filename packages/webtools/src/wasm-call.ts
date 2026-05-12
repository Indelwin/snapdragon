import type { WebtoolsExports, WebtoolsOp } from './wasm-types.js';

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true });

export function callWasmExport(
  exports: WebtoolsExports,
  op: WebtoolsOp,
  request: unknown,
): unknown {
  return dispatch(exports, exportFor(exports, op), request);
}

function dispatch(
  exports: WebtoolsExports,
  fn: (ptr: number, len: number) => bigint,
  request: unknown,
): unknown {
  const bytes = TEXT_ENCODER.encode(JSON.stringify(request));
  const inPtr = allocRequest(exports, bytes);
  new Uint8Array(exports.memory.buffer, inPtr, bytes.byteLength).set(bytes);
  const packed = callExportAndFreeRequest(exports, fn, inPtr, bytes.byteLength);
  const { ptr, len } = unpackResult(packed);
  return parseResponse(exports, ptr, len);
}

function allocRequest(exports: WebtoolsExports, bytes: Uint8Array): number {
  const ptr = exports.wt_alloc(bytes.byteLength);
  if (ptr === 0 && bytes.byteLength > 0) throw new Error('wt_alloc returned null pointer');
  return ptr;
}

function parseResponse(exports: WebtoolsExports, ptr: number, len: number): unknown {
  if (ptr === 0 || len === 0) throw new Error('webtools call returned an empty response');
  try {
    const view = new Uint8Array(exports.memory.buffer, ptr, len);
    return JSON.parse(TEXT_DECODER.decode(view.slice())) as unknown;
  } finally {
    exports.wt_dealloc(ptr, len);
  }
}

function callExportAndFreeRequest(
  exports: WebtoolsExports,
  fn: (ptr: number, len: number) => bigint,
  inPtr: number,
  len: number,
): bigint {
  try {
    return fn(inPtr, len);
  } finally {
    exports.wt_dealloc(inPtr, len);
  }
}

function unpackResult(packed: bigint): { ptr: number; len: number } {
  return {
    ptr: Number(packed >> 32n) >>> 0,
    len: Number(packed & 0xffff_ffffn) >>> 0,
  };
}

function exportFor(exports: WebtoolsExports, op: WebtoolsOp): (ptr: number, len: number) => bigint {
  switch (op) {
    case 'url_util':
      return exports.wt_url_util;
    case 'robots':
      return exports.wt_robots;
    case 'content_filter':
      return exports.wt_content_filter;
    case 'extractor':
      return exports.wt_extractor;
  }
}
