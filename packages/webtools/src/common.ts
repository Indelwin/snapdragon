import type { WebtoolsCore, WebtoolsOp } from './wasm.js';

export interface OkResponse<T> {
  ok: true;
  value: T;
}
export interface ErrResponse {
  ok: false;
  error: string;
}
export type WasmResponse<T> = OkResponse<T> | ErrResponse;

export function callWasm<T>(core: WebtoolsCore, module: WebtoolsOp, op: string, args: unknown): T {
  const resp = core.call<WasmResponse<T>>(module, { op, args });
  if (!resp.ok) {
    throw new Error(`webtools ${module}/${op}: ${resp.error}`);
  }
  return resp.value;
}
