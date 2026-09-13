import { WebtoolsResourceLimitError } from './resource-limits.js';
import { callWasmExport } from './wasm-call.js';
import { registerWebtoolsCore } from './wasm-diagnostics.js';
import {
  type WebtoolsCore,
  type WebtoolsDiagnostics,
  type WebtoolsExports,
  type WebtoolsOp,
  WebtoolsWasmRuntimeError,
} from './wasm-types.js';
import { assertWebtoolsExports } from './wasm-validate.js';

const WASM_PAGE_BYTES = 64 * 1024;

export async function instantiateWebtools(bytes: BufferSource): Promise<WebtoolsCore> {
  const ownedBytes = copyBytes(bytes);
  const module = await WebAssembly.compile(ownedBytes);
  return instantiateWebtoolsModule(module);
}

export function instantiateWebtoolsModule(module: WebAssembly.Module): WebtoolsCore {
  return new OwnedWebtoolsCore(module);
}

class OwnedWebtoolsCore implements WebtoolsCore {
  private exports: WebtoolsExports | undefined;
  private module: WebAssembly.Module | undefined;
  private releaseDiagnosticsRegistration: (() => void) | undefined;
  private maxMemoryPages = 0;
  private readonly counts = {
    calls: 0,
    successes: 0,
    requestEncodingFailures: 0,
    requestBudgetFailures: 0,
    responseBudgetFailures: 0,
    allocationFailures: 0,
    trapFailures: 0,
    corruptResponseFailures: 0,
    reinstantiations: 0,
    reinstantiationFailures: 0,
  };

  constructor(module: WebAssembly.Module) {
    this.module = module;
    this.exports = instantiateModule(module);
    this.sampleMemoryPages();
    this.releaseDiagnosticsRegistration = registerWebtoolsCore(this);
  }

  call<T>(op: WebtoolsOp, request: unknown): T {
    const exports = this.activeExports();
    this.counts.calls += 1;
    try {
      const result = callWasmExport(exports, op, request) as T;
      this.counts.successes += 1;
      this.sampleMemoryPages();
      return result;
    } catch (error) {
      this.sampleMemoryPages();
      if (this.recordRecoverableFailure(error)) this.recoverInstance();
      throw error;
    }
  }

  diagnostics(): Readonly<WebtoolsDiagnostics> {
    const memoryPages = this.exports?.memory.buffer.byteLength
      ? this.exports.memory.buffer.byteLength / WASM_PAGE_BYTES
      : 0;
    return Object.freeze({ ...this.counts, memoryPages, maxMemoryPages: this.maxMemoryPages });
  }

  dispose(): void {
    this.sampleMemoryPages();
    this.exports = undefined;
    this.module = undefined;
    this.releaseDiagnosticsRegistration?.();
    this.releaseDiagnosticsRegistration = undefined;
  }

  private activeExports(): WebtoolsExports {
    if (this.exports === undefined || this.module === undefined) {
      throw new Error('webtools wasm core is disposed');
    }
    return this.exports;
  }

  private recordRecoverableFailure(error: unknown): boolean {
    if (error instanceof WebtoolsResourceLimitError) {
      if (error.resource === 'WASM ABI request bytes') {
        this.counts.requestBudgetFailures += 1;
        return false;
      }
      if (error.resource === 'WASM ABI response bytes') {
        this.counts.responseBudgetFailures += 1;
        return true;
      }
    }
    if (error instanceof WebtoolsWasmRuntimeError) {
      switch (error.failure) {
        case 'allocation':
          this.counts.allocationFailures += 1;
          return true;
        case 'trap':
          this.counts.trapFailures += 1;
          return true;
        case 'corrupt_response':
          this.counts.corruptResponseFailures += 1;
          return true;
      }
    }
    this.counts.requestEncodingFailures += 1;
    return false;
  }

  private reinstantiate(): void {
    const module = this.module;
    if (module === undefined) return;
    this.exports = undefined;
    this.exports = instantiateModule(module);
    this.counts.reinstantiations += 1;
    this.sampleMemoryPages();
  }

  private recoverInstance(): void {
    try {
      this.reinstantiate();
    } catch {
      this.counts.reinstantiationFailures += 1;
      this.exports = undefined;
      this.module = undefined;
      this.releaseDiagnosticsRegistration?.();
      this.releaseDiagnosticsRegistration = undefined;
    }
  }

  private sampleMemoryPages(): void {
    const pages = this.exports?.memory.buffer.byteLength
      ? this.exports.memory.buffer.byteLength / WASM_PAGE_BYTES
      : 0;
    this.maxMemoryPages = Math.max(this.maxMemoryPages, pages);
  }
}

function instantiateModule(module: WebAssembly.Module): WebtoolsExports {
  const instance = new WebAssembly.Instance(module, {});
  return assertWebtoolsExports(instance.exports);
}

function copyBytes(bytes: BufferSource): Uint8Array<ArrayBuffer> {
  const source = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  const owned = new Uint8Array(source.byteLength);
  owned.set(source);
  return owned;
}
