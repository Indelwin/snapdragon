import { WebtoolsResourceLimitError } from './resource-limits.js';
import { type WebtoolsExports, WebtoolsWasmRuntimeError } from './wasm-types.js';

const TEXT_ENCODER = new TextEncoder();

const REQUIRED_EXPORTS = [
  'wt_alloc',
  'wt_dealloc',
  'wt_url_util',
  'wt_robots',
  'wt_content_filter',
  'wt_extractor',
] as const;

const RESPONSE_VALIDATORS = new Map<unknown, (value: Record<string, unknown>) => boolean>([
  [true, (value) => Object.hasOwn(value, 'value')],
  [false, (value) => typeof value.error === 'string'],
]);

export function assertWebtoolsExports(exports: WebAssembly.Exports): WebtoolsExports {
  const candidate = exports as unknown as Partial<WebtoolsExports>;
  const hasMemory = candidate.memory instanceof WebAssembly.Memory;
  const hasFunctions = REQUIRED_EXPORTS.every((name) => typeof candidate[name] === 'function');
  if (![hasMemory, hasFunctions].every(Boolean)) throw missingExports();
  return candidate as WebtoolsExports;
}

export function assertWebtoolsResponse(value: unknown): unknown {
  if (!isRecord(value)) throw invalidResponse();
  const validator = RESPONSE_VALIDATORS.get(value.ok);
  if (validator?.(value) !== true) throw invalidResponse();
  return value;
}

export function encodeWasmRequest(request: unknown, maxBytes: number): Uint8Array<ArrayBuffer> {
  const json = JSON.stringify(request);
  if (json === undefined) throw new TypeError('webtools wasm request is not JSON serializable');
  const bytes = TEXT_ENCODER.encode(json);
  if (bytes.byteLength > maxBytes) {
    throw new WebtoolsResourceLimitError('WASM ABI request bytes', maxBytes, bytes.byteLength);
  }
  return bytes;
}

export function assertWasmAllocation(ptr: number): void {
  if (ptr === 0) {
    throw new WebtoolsWasmRuntimeError('allocation', 'webtools wasm request allocation failed');
  }
}

export function isWasmMemoryRange(memory: WebAssembly.Memory, ptr: number, len: number): boolean {
  return ptr !== 0 && len !== 0 && ptr + len <= memory.buffer.byteLength;
}

export function assertWasmResponseRange(
  memory: WebAssembly.Memory,
  ptr: number,
  len: number,
  maxBytes: number,
): void {
  if (len > maxBytes) {
    throw new WebtoolsResourceLimitError('WASM ABI response bytes', maxBytes, len);
  }
  if ([ptr, len].includes(0)) throw new Error('webtools wasm call returned an empty response');
  if (!isWasmMemoryRange(memory, ptr, len)) {
    throw new Error('webtools wasm call returned a response outside linear memory');
  }
}

function missingExports(): Error {
  return new Error('webtools wasm module is missing required exports');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): Error {
  return new Error('webtools wasm call returned an invalid response envelope');
}
