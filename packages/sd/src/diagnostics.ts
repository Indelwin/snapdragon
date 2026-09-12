import type { SdDiagnosticsOptions } from './diagnostics-types.js';
import { registerSdWasmPageGetter } from './diagnostics-wasm.js';
import { startSdDiagnostics } from './diagnostics-writer.js';
import type { SdRuntimeOptions } from './runtime-options.js';

export function startSdRuntimeDiagnostics(
  runtimeOptions: Pick<SdRuntimeOptions, 'diagnostics'>,
  options: Omit<SdDiagnosticsOptions, 'enabled'> = {},
) {
  return startSdDiagnostics({ ...options, enabled: runtimeOptions.diagnostics === true });
}

export type {
  SdDiagnosticsHandle,
  SdDiagnosticsOptions,
  SdDiagnosticsPhase,
  SdDiagnosticsSample,
  SdDiagnosticsWasmModule,
  SdDiagnosticsWasmPageGetter,
} from './diagnostics-types.js';
export {
  DEFAULT_SD_DIAGNOSTICS_DIRECTORY,
  SD_DIAGNOSTICS_FILENAME,
} from './diagnostics-writer.js';
export { registerSdWasmPageGetter, startSdDiagnostics };
