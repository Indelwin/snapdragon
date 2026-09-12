import { registerSdWasmPageGetter } from './diagnostics-wasm.js';

type WebtoolsModuleLoader = () => Promise<unknown>;
type WebtoolsStatsGetter = () => unknown;

const loadWebtoolsModule: WebtoolsModuleLoader = () => import('@snapdragon-ai/webtools');

export async function registerSdWebtoolsWasmPages(
  enabled: boolean,
  loadModule: WebtoolsModuleLoader = loadWebtoolsModule,
): Promise<() => void> {
  if (!enabled) return noOp;
  const module = await loadModule().catch(() => null);
  const getStats = statsGetter(module);
  if (!getStats) return noOp;
  return registerSdWasmPageGetter('webtools', () => memoryPages(getStats()));
}

function statsGetter(module: unknown): WebtoolsStatsGetter | undefined {
  if (!module || typeof module !== 'object') return undefined;
  if (!('getWebtoolsWasmMemoryStats' in module)) return undefined;
  const getter = module.getWebtoolsWasmMemoryStats;
  return typeof getter === 'function' ? () => getter.call(module) : undefined;
}

function memoryPages(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object' || !('memoryPages' in stats)) return null;
  return typeof stats.memoryPages === 'number' ? stats.memoryPages : null;
}

function noOp(): void {}
