import type { WebtoolsCore } from './wasm-types.js';

export type WebtoolsCoreOwnership = 'owned' | 'borrowed';

export function disposeOwnedCore(core: WebtoolsCore, ownership: WebtoolsCoreOwnership): void {
  if (ownership === 'owned') core.dispose();
}
