import { WebtoolsResourceLimitError } from './resource-limits.js';

export interface WebtoolsExports {
  memory: WebAssembly.Memory;
  wt_alloc: (size: number) => number;
  wt_dealloc: (ptr: number, size: number) => void;
  wt_url_util: (ptr: number, len: number) => bigint;
  wt_robots: (ptr: number, len: number) => bigint;
  wt_content_filter: (ptr: number, len: number) => bigint;
  wt_extractor: (ptr: number, len: number) => bigint;
}

export type WebtoolsOp = 'url_util' | 'robots' | 'content_filter' | 'extractor';

export type WebtoolsWasmFailureKind = 'allocation' | 'trap' | 'corrupt_response';

export class WebtoolsWasmRuntimeError extends Error {
  readonly code = 'WEBTOOLS_WASM_RUNTIME';

  constructor(
    readonly failure: WebtoolsWasmFailureKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'WebtoolsWasmRuntimeError';
  }
}

export function asWasmResponseError(error: unknown): unknown {
  if (error instanceof WebtoolsResourceLimitError) return error;
  if (error instanceof WebtoolsWasmRuntimeError) return error;
  return new WebtoolsWasmRuntimeError(
    'corrupt_response',
    'webtools wasm call returned a corrupt response',
    error,
  );
}

export function asWasmRuntimeError(
  error: unknown,
  failure: 'allocation' | 'trap',
): WebtoolsWasmRuntimeError {
  if (error instanceof WebtoolsWasmRuntimeError) return error;
  const actions = {
    allocation: 'allocation failed',
    trap: 'execution trapped',
  } as const;
  return new WebtoolsWasmRuntimeError(failure, `webtools wasm ${actions[failure]}`, error);
}

const EXPORT_NAMES = {
  url_util: 'wt_url_util',
  robots: 'wt_robots',
  content_filter: 'wt_content_filter',
  extractor: 'wt_extractor',
} as const satisfies Record<WebtoolsOp, keyof WebtoolsExports>;

export function webtoolsExportFor(
  exports: WebtoolsExports,
  op: WebtoolsOp,
): (ptr: number, len: number) => bigint {
  return exports[EXPORT_NAMES[op]] as (ptr: number, len: number) => bigint;
}

/** Numeric-only operational data; request and response payloads are never retained. */
export interface WebtoolsDiagnostics {
  calls: number;
  successes: number;
  requestEncodingFailures: number;
  requestBudgetFailures: number;
  responseBudgetFailures: number;
  allocationFailures: number;
  trapFailures: number;
  corruptResponseFailures: number;
  reinstantiations: number;
  reinstantiationFailures: number;
  memoryPages: number;
  maxMemoryPages: number;
}

export interface WebtoolsCore {
  call<T>(op: WebtoolsOp, request: unknown): T;
  diagnostics(): Readonly<WebtoolsDiagnostics>;
  dispose(): void;
}
