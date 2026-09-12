import type { SdExtensionDisposable, SdExtensionRuntime } from './extension-runtime-types.js';

export interface ExtensionDisposalState {
  callbacks: Array<{ extensionId: string; dispose: () => void | Promise<void> }>;
  promise?: Promise<void>;
  errors?: SdExtensionRuntime['errors'];
}

export function extensionDisposalState(): ExtensionDisposalState {
  return { callbacks: [] };
}

export function registerExtensionDisposable(
  state: ExtensionDisposalState,
  extensionId: string,
  disposable: SdExtensionDisposable,
): void {
  state.callbacks.push({
    extensionId,
    dispose: typeof disposable === 'function' ? disposable : () => disposable.dispose(),
  });
}

export function disposeExtensions(state: ExtensionDisposalState): Promise<void> {
  state.promise ??= runExtensionDisposal(state);
  return state.promise;
}

async function runExtensionDisposal(state: ExtensionDisposalState): Promise<void> {
  for (const callback of [...state.callbacks].reverse()) {
    try {
      await callback.dispose();
    } catch (error) {
      state.errors?.push({
        extensionId: callback.extensionId,
        message: `deactivation failed: ${errorMessage(error)}`,
      });
    }
  }
  state.callbacks.length = 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
