import type {
  SdDiagnosticsSample,
  SdDiagnosticsWasmModule,
  SdDiagnosticsWasmPageGetter,
} from './diagnostics-types.js';

const wasmPageGetters = new Map<SdDiagnosticsWasmModule, SdDiagnosticsWasmPageGetter>();

export function registerSdWasmPageGetter(
  module: SdDiagnosticsWasmModule,
  getter: SdDiagnosticsWasmPageGetter,
): () => void {
  wasmPageGetters.set(module, getter);
  return () => {
    if (wasmPageGetters.get(module) === getter) wasmPageGetters.delete(module);
  };
}

export function diagnosticsWasmPages(): SdDiagnosticsSample['wasmPages'] {
  return { core: wasmPages('core'), webtools: wasmPages('webtools') };
}

function wasmPages(module: SdDiagnosticsWasmModule): number | null {
  const getter = wasmPageGetters.get(module);
  if (!getter) return null;
  try {
    const value = getter();
    if (value === null || value === undefined) return null;
    if (!Number.isFinite(value) || value < 0) return null;
    return Math.floor(value);
  } catch {
    return null;
  }
}
